import { parseBillSpec, prepareBill, createBill, getBill, BillInputError } from "../bills";
import { fakeSupabase } from "../testing/fakeSupabase";

const VID = "29c3daa8-5483-4c84-8959-1c930b8d1bb4";

// Paper slip 387: Test Customer, Mustard georgette saree BC252051, MRP 2395, sold 1800 cash.
const slip387 = {
  customerid: 453,
  date: "2026-10-22",
  payment: { method: "cash", amount: 1800 },
  items: [{ variantid: VID, qty: 1, amount: 1800 }],
};

const db = (overrides = {}) => ({
  "customers.select": { data: { customerid: 453, first_name: "Test", last_name: "Customer", phone: "+919000000001" }, error: null },
  "salesmethods.select": {
    data: [
      { salesmethodid: 1, methodname: "Cash" },
      { salesmethodid: 2, methodname: "UPI" },
      { salesmethodid: 7, methodname: "Website" },
    ],
    error: null,
  },
  "saleslocations.select": { data: [{ saleslocationid: 1, locationname: "Walk-In" }], error: null },
  "productsizecolors.select": {
    data: [{ variantid: VID, productid: "BC252051", size: "FREE-SIZE", color: "Mustard", stock: 1 }],
    error: null,
  },
  "products.select": {
    data: [{ productid: "BC252051", name: "Georgette-Saree", categoryid: "SA", retailprice: 2395, unit_type: "piece" }],
    error: null,
  },
  "manual_items.select": {
    data: [{ manual_item_id: "BCX26129", name: "Fall", categoryid: "ACC", size: null, color: null, purchase_price: 50, mrp: 150 }],
    error: null,
  },
  ...overrides,
});

describe("parseBillSpec", () => {
  it.each([
    [{ ...slip387, customerid: "x" }, /customerid/],
    [{ ...slip387, date: "22/10/2026" }, /date: expected YYYY-MM-DD/],
    [{ ...slip387, payment: { amount: 1800 } }, /payment.method is required/],
    [{ ...slip387, payment: { method: "Cash", amount: 0 } }, /payment.amount must be > 0/],
    [{ ...slip387, items: [] }, /at least one item/],
    [{ ...slip387, items: [{ qty: 1 }] }, /exactly one of variantid or manual_item_id/],
    [{ ...slip387, items: [{ variantid: VID, manual_item_id: "BCX1", qty: 1 }] }, /exactly one of/],
    [{ ...slip387, items: [{ variantid: VID, qty: 0 }] }, /qty must be > 0/],
    [{ ...slip387, items: [{ variantid: VID, qty: 1, stitch_type: "half" }] }, /stitch_type/],
  ])("rejects a malformed spec %#", (spec, msg) => {
    expect(() => parseBillSpec(spec)).toThrow(msg);
  });

  it("defaults location to Walk-In and stock to on", () => {
    const s = parseBillSpec(slip387);
    expect(s.location).toBe("Walk-In");
    expect(s.skip_stock).toBe(false);
    expect(s.items[0]).toMatchObject({ amount: 1800, alteration_charge: 0, stitch_type: "unstitched" });
  });
});

describe("prepareBill — slip 387", () => {
  it("prices the line like the billing screen and lands the total on the amount paid", async () => {
    const p = await prepareBill(fakeSupabase(db()), slip387);
    expect(p.totals).toEqual({ mrp_total: 2395, line_discounts: 594.92, balance_discount: 0.08, grand_total: 1800, paid: 1800 });
    expect(p.bill).toMatchObject({
      customerid: 453,
      document_type: "bos",
      totalamount: 1800,
      gst_total: 0,
      discount_total: 595,
      taxable_total: 1800,
      paymentstatus: "finalized",
      finalized: true,
      payment_amount: 1800,
      salesmethodid: 1,
      saleslocationid: 1,
      orderdate: "2026-10-22T00:00:00+05:30",
    });
    expect(p.bill_items).toEqual([
      expect.objectContaining({
        variantid: VID,
        product_code: "BC252051",
        product_name: "Georgette-Saree",
        category: "SA",
        quantity: 1,
        mrp: 2395,
        discount_total: 595,
        subtotal: 1800,
        total: 1800,
        gst_rate: null,
        gst_amount: 0,
        cost_price: null,
        stitch_type: "unstitched",
        unit_type: "piece",
      }),
    ]);
    expect(p.stock).toEqual([
      { variantid: VID, productid: "BC252051", size: "FREE-SIZE", color: "Mustard", stock_before: 1, change: -1, stock_after: 0 },
    ]);
    expect(p.warnings).toEqual([]);
  });

  it("is read-only", async () => {
    const client = fakeSupabase(db());
    await prepareBill(client, slip387);
    expect(client.calls.every((c) => c.op === "select")).toBe(true);
  });

  it("refuses when stock would go negative, unless skip_stock", async () => {
    const stock0 = db({
      "productsizecolors.select": { data: [{ variantid: VID, productid: "BC252051", size: "FREE-SIZE", color: "Mustard", stock: 0 }], error: null },
    });
    await expect(prepareBill(fakeSupabase(stock0), slip387)).rejects.toThrow(/Insufficient stock: BC252051 Mustard\/FREE-SIZE has 0, needs 1/);
    const p = await prepareBill(fakeSupabase(stock0), { ...slip387, skip_stock: true });
    expect(p.stock[0]).toMatchObject({ change: 0, stock_after: 0 });
  });

  it("uses manual item MRP, cost and category", async () => {
    const p = await prepareBill(fakeSupabase(db()), {
      ...slip387,
      payment: { method: "UPI", amount: 150 },
      items: [{ manual_item_id: "bcx26129", qty: 1 }],
    });
    expect(p.bill_items[0]).toMatchObject({ product_code: "BCX26129", variantid: null, mrp: 150, cost_price: 50, category: "ACC", total: 150 });
    expect(p.bill.salesmethodid).toBe(2);
    expect(p.stock).toEqual([]);
  });

  it("charges alteration on top of the goods amount", async () => {
    const p = await prepareBill(fakeSupabase(db()), {
      ...slip387,
      payment: { method: "Cash", amount: 1950 },
      items: [{ variantid: VID, qty: 1, amount: 1800, alteration_charge: 150 }],
    });
    expect(p.totals.grand_total).toBe(1950);
    // App parity: the item row's stored total drifts by a paisa from the bill
    // total when alteration is involved (buildBillItemsPayload rounding).
    expect(p.bill_items[0]).toMatchObject({ alteration_charge: 150, total: 1950.01 });
  });

  it.each([
    [{ items: [{ variantid: VID, qty: 1, amount: 2500 }] }, /above MRP/],
    [{ items: [{ variantid: VID, qty: 1, amount: 1000 }], payment: { method: "Cash", amount: 1000 } }, /over the billing screen's 50% limit/],
    [{ payment: { method: "Website", amount: 1800 } }, /Unknown payment method "Website"/],
    [{ payment: { method: "Barter", amount: 1800 } }, /one of: Cash, UPI/],
    [{ location: "Moon" }, /Unknown location "Moon"/],
    [{ payment: { method: "Cash", amount: 1600 } }, /differs from the bill total 1800.08 by 200.08/],
    [{ items: [{ variantid: "nope", qty: 1 }] }, /variant nope not found/],
  ])("refuses what the billing screen would refuse %#", async (patch, msg) => {
    await expect(prepareBill(fakeSupabase(db()), { ...slip387, ...patch })).rejects.toThrow(msg);
  });

  it("refuses an unknown customer", async () => {
    const client = fakeSupabase(db({ "customers.select": { data: null, error: null } }));
    await expect(prepareBill(client, slip387)).rejects.toThrow(BillInputError);
  });

  it("warns on a discount over 30% and on overpayment", async () => {
    const p = await prepareBill(fakeSupabase(db()), {
      ...slip387,
      payment: { method: "Cash", amount: 1550 },
      items: [{ variantid: VID, qty: 1, amount: 1500 }],
    });
    expect(p.warnings).toEqual([
      expect.stringMatching(/37.36% discount on Georgette-Saree/),
      // An overpayment is recorded as is rather than lifting the total.
      expect.stringMatching(/paid ₹49.77 more than the bill total 1500.23/),
    ]);
  });

  it("rounds the % down so the bill lands exactly on the amount paid", async () => {
    // 145 off 1495 is 9.699%: rounding to nearest (9.70%) gives 1349.98, which
    // nothing lifts back; rounding down (9.69%) gives 1350.13, trimmed to 1350.
    const p = await prepareBill(fakeSupabase(db({
      "products.select": { data: [{ productid: "BC252051", name: "Kurta", categoryid: "KP", retailprice: 1495, unit_type: "piece" }], error: null },
    })), { ...slip387, payment: { method: "Cash", amount: 1350 }, items: [{ variantid: VID, qty: 1, amount: 1350 }] });
    expect(p.totals.grand_total).toBe(1350);
    expect(p.bill_items[0]).toMatchObject({ subtotal: 1350, discount_total: 145 });
  });

  it("takes a per-line unit, else the product's / FAB- category default", async () => {
    const p = await prepareBill(fakeSupabase(db()), {
      ...slip387,
      payment: { method: "Cash", amount: 1950 },
      items: [{ variantid: VID, qty: 1, amount: 1800 }, { manual_item_id: "BCX26129", qty: 1, unit_type: "meter" }],
    });
    expect(p.bill_items.map((i) => i.unit_type)).toEqual(["piece", "meter"]);
    expect(() => parseBillSpec({ ...slip387, items: [{ variantid: VID, qty: 1, unit_type: "kg" }] })).toThrow(/unit_type/);
  });
});

describe("createBill", () => {
  const saved = { billid: 900, bill_number: "FY26-000336" };

  it("dry run returns the plan and writes nothing", async () => {
    const client = fakeSupabase(db());
    const out = await createBill(client, slip387, { dryRun: true });
    expect(out.dry_run).toBe(true);
    expect(out.bill.totalamount).toBe(1800);
    expect(client.calls.every((c) => c.op === "select")).toBe(true);
  });

  it("writes bill, items, stock and activity log in the screen's order", async () => {
    const client = fakeSupabase(db({
      "bills.insert": { data: saved, error: null },
      "bill_items.insert": { data: null, error: null },
      "rpc.stock_adjust": { data: 0, error: null },
      "activity_log.insert": { data: null, error: null },
    }));
    const out = await createBill(client, slip387);
    const writes = client.calls.filter((c) => c.op !== "select").map((c) => c.fn ?? `${c.table}.${c.op}`);
    expect(writes).toEqual(["bills.insert", "bill_items.insert", "stock_adjust", "activity_log.insert"]);
    expect(client.calls.find((c) => c.table === "bill_items").row[0].billid).toBe(900);
    expect(client.calls.find((c) => c.fn === "stock_adjust").args).toEqual({
      p_variant: VID, p_delta: -1, p_reason: "bill_finalize", p_ref: "900",
    });
    expect(client.calls.find((c) => c.table === "activity_log").row).toEqual({
      actor_id: null,
      action: "create",
      entity_type: "bill",
      entity_id: "FY26-000336",
      summary: "Finalized bill #FY26-000336 for Test Customer — ₹1,800, 1 items (via CLI)",
    });
    expect(out).toMatchObject({ billid: 900, bill_number: "FY26-000336", stock_failures: [] });
    expect(client.calls.some((c) => c.table === "bill_payments")).toBe(false);
  });

  it("removes the bill row when the items insert fails", async () => {
    const client = fakeSupabase(db({
      "bills.insert": { data: saved, error: null },
      "bill_items.insert": { data: null, error: new Error("items boom") },
      "bills.delete": { data: null, error: null },
    }));
    await expect(createBill(client, slip387)).rejects.toThrow("Failed to save bill items: items boom (bill 900 removed)");
    expect(client.calls.find((c) => c.op === "delete").filters).toEqual([["eq", "billid", 900]]);
    expect(client.calls.some((c) => c.fn === "stock_adjust")).toBe(false);
  });

  it("keeps the bill but reports a stock failure", async () => {
    const client = fakeSupabase(db({
      "bills.insert": { data: saved, error: null },
      "bill_items.insert": { data: null, error: null },
      "rpc.stock_adjust": { data: null, error: new Error("variant gone") },
      "activity_log.insert": { data: null, error: null },
    }));
    const out = await createBill(client, slip387);
    expect(out.stock_failures).toEqual([{ variantid: VID, change: -1, error: "variant gone" }]);
  });
});

describe("getBill", () => {
  it("returns null for an unknown bill number", async () => {
    const client = fakeSupabase({ "bills.select": { data: null, error: null } });
    await expect(getBill(client, { billNumber: "fy26-000999" })).resolves.toBeNull();
    expect(client.calls[0].filters).toEqual([["eq", "bill_number", "FY26-000999"]]);
  });

  it("joins items, payments, customer, method, location and current stock", async () => {
    const client = fakeSupabase({
      ...db(),
      "bills.select": { data: { billid: 900, bill_number: "FY26-000336", customerid: 453, salesmethodid: 1, saleslocationid: 1 }, error: null },
      "bill_items.select": { data: [{ bill_item_id: 1, variantid: VID, quantity: 1 }], error: null },
      "bill_payments.select": { data: [], error: null },
      "salesmethods.select": { data: { methodname: "Cash" }, error: null },
      "saleslocations.select": { data: { locationname: "Walk-In" }, error: null },
    });
    const b = await getBill(client, { billid: 900 });
    expect(b).toMatchObject({
      bill_number: "FY26-000336",
      payment_method: "Cash",
      location: "Walk-In",
      customer: { first_name: "Test" },
      items: [{ bill_item_id: 1, color: "Mustard", size: "FREE-SIZE", current_stock: 1 }],
      payments: [],
    });
  });

  it("needs an id or number", async () => {
    await expect(getBill(fakeSupabase(), {})).rejects.toThrow(BillInputError);
  });
});
