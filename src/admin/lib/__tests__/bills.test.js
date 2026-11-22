import { parseBillSpec, prepareBill, createBill, getBill, findBills, resolveSalespersons, checkBillAgainstSpec, splitByMrpShare, BillInputError } from "../bills";
import { fakeSupabase } from "../testing/fakeSupabase";

// jsdom (CRA's jest env) has no crypto.randomUUID, which createCustomer uses
// for customer_ulid; browsers and Node do.
if (!global.crypto?.randomUUID) {
  Object.defineProperty(global, "crypto", { value: require("crypto").webcrypto, configurable: true });
}

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
    data: [{ manual_item_id: "BCX26129", name: "Fall", categoryid: "ACC", size: null, color: null, purchase_price: 50, mrp: 150, stock: 1 }],
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
    [{ ...slip387, items: [{ qty: 1 }] }, /exactly one of product, variantid, manual_item_id or manual_item/],
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

  it("says which stock add command would cover a shortfall", async () => {
    const short = db({
      "productsizecolors.select": { data: [{ variantid: VID, productid: "BC252051", size: "XL|42", color: "Mustard", stock: 1 }], error: null },
    });
    await expect(prepareBill(fakeSupabase(short), { ...slip387, items: [{ variantid: VID, qty: 3, amount: 5400 }] })).rejects.toThrow(
      "Insufficient stock: BC252051 Mustard/XL|42 has 1, needs 3. If the pieces are on the shelf, add them: " +
        "stock add --code BC252051 --size 'XL|42' --color 'Mustard' --qty 2",
    );
  });

  it("records whether the bill took stock, so cancelling it gives back only what left the shelf", async () => {
    expect((await prepareBill(fakeSupabase(db()), slip387)).bill.stock_reduced).toBe(true);
    expect((await prepareBill(fakeSupabase(db()), { ...slip387, skip_stock: true })).bill.stock_reduced).toBe(false);
  });

  it("uses manual item MRP, cost and category", async () => {
    const p = await prepareBill(fakeSupabase(db()), {
      ...slip387,
      payment: { method: "UPI", amount: 150 },
      items: [{ manual_item_id: "bcx26129", qty: 1 }],
    });
    expect(p.bill_items[0]).toMatchObject({ product_code: "BCX26129", variantid: null, mrp: 150, cost_price: 50, category: "ACC", total: 150 });
    expect(p.bill.salesmethodid).toBe(2);
    // A sale takes manual-item stock too (schema/migration_manual_item_stock.sql).
    expect(p.stock).toEqual([{ manual_item_id: "BCX26129", name: "Fall", stock_before: 1, change: -1, stock_after: 0 }]);
  });

  it("takes a fabric manual item's stock by the exact metres", async () => {
    const fabric = db({
      "manual_items.select": {
        data: [{ manual_item_id: "BCX26129", name: "Cotton", categoryid: "FAB-COT", size: null, color: null, purchase_price: 50, mrp: 100, stock: 5 }],
        error: null,
      },
    });
    const p = await prepareBill(fakeSupabase(fabric), {
      ...slip387,
      payment: { method: "UPI", amount: 350 },
      items: [{ manual_item_id: "BCX26129", qty: 3.5 }],
    });
    expect(p.stock).toEqual([{ manual_item_id: "BCX26129", name: "Cotton", stock_before: 5, change: -3.5, stock_after: 1.5 }]);
  });

  it("refuses an existing manual item already sold, unless skip_stock", async () => {
    const sold = db({
      "manual_items.select": {
        data: [{ manual_item_id: "BCX26129", name: "Fall", categoryid: "ACC", size: null, color: null, purchase_price: 50, mrp: 150, stock: 0 }],
        error: null,
      },
    });
    const spec = { ...slip387, payment: { method: "UPI", amount: 150 }, items: [{ manual_item_id: "BCX26129", qty: 1 }] };
    await expect(prepareBill(fakeSupabase(sold), spec)).rejects.toThrow(
      "Insufficient stock: manual item BCX26129 (Fall) has 0, needs 1. It is already sold; for a different piece, use manual_item { create } instead",
    );
    const p = await prepareBill(fakeSupabase(sold), { ...spec, skip_stock: true });
    expect(p.stock).toEqual([{ manual_item_id: "BCX26129", name: "Fall", stock_before: 0, change: 0, stock_after: 0 }]);
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

  it("saves bill, items and stock in one bill_save, then logs it, as the screen does", async () => {
    const client = fakeSupabase(db({
      "rpc.bill_save": { data: { ...saved, negative_stock: [] }, error: null },
      "activity_log.insert": { data: null, error: null },
    }));
    const out = await createBill(client, slip387);
    const writes = client.calls.filter((c) => c.op !== "select").map((c) => c.fn ?? `${c.table}.${c.op}`);
    expect(writes).toEqual(["bill_save", "activity_log.insert"]);
    const { args } = client.calls.find((c) => c.fn === "bill_save");
    expect(args.p_op).toBe("finalize_create");
    expect(args.p_key).toMatch(/^[0-9a-f-]{36}$/);
    expect(args.p_payload.skip_stock).toBe(false);
    expect(args.p_payload.bill).not.toHaveProperty("stock_reduced");
    expect(args.p_payload.bill).toMatchObject({ customerid: 453, paymentstatus: "finalized", finalized: true, payment_amount: 1800 });
    expect(args.p_payload.items).toEqual([expect.objectContaining({ billid: null, variantid: VID, quantity: 1 })]);
    expect(args.p_payload).not.toHaveProperty("first_payment");
    expect(client.calls.find((c) => c.table === "activity_log").row).toEqual({
      actor_id: null,
      action: "create",
      entity_type: "bill",
      entity_id: "FY26-000336",
      summary: "Finalized bill #FY26-000336 for Test Customer — ₹1,800, 1 items (via CLI)",
    });
    expect(out).toMatchObject({ billid: 900, bill_number: "FY26-000336", negative_stock: [] });
  });

  it("sends skip_stock to bill_save, which then moves no stock and records it", async () => {
    const client = fakeSupabase(db({ "rpc.bill_save": { data: saved, error: null } }));
    await createBill(client, { ...slip387, skip_stock: true });
    expect(client.calls.find((c) => c.fn === "bill_save").args.p_payload.skip_stock).toBe(true);
  });

  it("a refused save writes nothing else, deletes nothing and says why", async () => {
    const client = fakeSupabase(db({
      "rpc.bill_save": { data: null, error: { message: "BILL_BAD_PAYLOAD", details: "unknown variant" } },
    }));
    await expect(createBill(client, slip387)).rejects.toThrow("Failed to save bill: BILL_BAD_PAYLOAD (unknown variant)");
    expect(client.calls.filter((c) => c.op !== "select").map((c) => c.fn ?? `${c.table}.${c.op}`)).toEqual(["bill_save"]);
  });

  it("reports a variant the save took below zero", async () => {
    const client = fakeSupabase(db({
      "rpc.bill_save": { data: { ...saved, negative_stock: [{ variantid: VID, stock: -1 }] }, error: null },
    }));
    const out = await createBill(client, slip387);
    expect(out.negative_stock).toEqual([{ variantid: VID, stock: -1 }]);
  });
});

describe("part payment (payment.balance_due)", () => {
  const saved = { billid: 901, bill_number: "FY26-000337" };
  // Slip 387's saree sold for 1800: 1000 paid now, 800 still owed.
  const partial = { ...slip387, payment: { method: "Cash", amount: 1000, balance_due: 800 } };

  it.each([
    [{ ...slip387, payment: { method: "Cash", amount: 1000, balance_due: -1 } }, /balance_due must be >= 0/],
    [{ ...slip387, payment: { method: "Cash", amount: 1000, balance_due: "x" } }, /balance_due/],
  ])("rejects a bad balance_due %#", (spec, msg) => {
    expect(() => parseBillSpec(spec)).toThrow(msg);
  });

  it("prices the bill at paid + balance due and marks it partial, as the screen's partial finalize", async () => {
    const p = await prepareBill(fakeSupabase(db()), partial);
    expect(p.totals).toEqual({
      mrp_total: 2395, line_discounts: 594.92, balance_discount: 0.08, grand_total: 1800, paid: 1000, balance_due: 800,
    });
    expect(p.bill).toMatchObject({
      totalamount: 1800,
      net_amount: 1800,
      final_amount: 1800,
      paymentstatus: "partial",
      finalized: true,
      payment_amount: 1000,
      salesmethodid: 1,
    });
  });

  it("still refuses a shortfall that balance_due does not explain", async () => {
    await expect(
      prepareBill(fakeSupabase(db()), { ...slip387, payment: { method: "Cash", amount: 500, balance_due: 800 } }),
    ).rejects.toThrow(/differs from the bill total/);
  });

  it("sends the first payment, dated the bill date, in the same bill_save", async () => {
    const client = fakeSupabase(db({
      "rpc.bill_save": { data: saved, error: null },
      "activity_log.insert": { data: null, error: null },
    }));
    const out = await createBill(client, partial);
    const writes = client.calls.filter((c) => c.op !== "select").map((c) => c.fn ?? `${c.table}.${c.op}`);
    expect(writes).toEqual(["bill_save", "activity_log.insert"]);
    const { args } = client.calls.find((c) => c.fn === "bill_save");
    expect(args.p_op).toBe("partial_create");
    expect(args.p_payload.first_payment).toEqual({ amount: 1000, salesmethodid: 1, recorded_at: "2026-10-22T12:00:00" });
    expect(args.p_payload.bill.payment_amount).toBe(1000);
    expect(client.calls.find((c) => c.table === "activity_log").row.summary).toBe(
      "Finalized bill (partial) #FY26-000337 for Test Customer — ₹1,800, 1 items (via CLI)",
    );
    expect(out.totals.balance_due).toBe(800);
  });

  it("allows nothing paid yet when the whole amount is due, as the screen does", async () => {
    const unpaid = { ...slip387, payment: { amount: 0, balance_due: 1800 } };
    const p = await prepareBill(fakeSupabase(db()), unpaid);
    expect(p.bill).toMatchObject({
      totalamount: 1800, final_amount: 1800, paymentstatus: "partial", payment_amount: 0, salesmethodid: null,
    });
    expect(p.payment_method).toBeNull();
    expect(p.first_payment).toBeNull();

    const client = fakeSupabase(db({
      "rpc.bill_save": { data: saved, error: null },
      "activity_log.insert": { data: null, error: null },
    }));
    await createBill(client, unpaid);
    const { args } = client.calls.find((c) => c.fn === "bill_save");
    expect(args.p_op).toBe("partial_create");
    expect(args.p_payload).not.toHaveProperty("first_payment");
    expect(args.p_payload.bill.payment_amount).toBe(0);
  });

  it.each([
    [{ ...slip387, payment: { method: "Cash", amount: 0 } }, /payment.amount must be > 0/],
    [{ ...slip387, payment: { amount: 1800 } }, /payment.method is required/],
    [{ ...slip387, payment: { method: "Cash", amount: 0, balance_due: 1800 } }, /no payment.method when nothing is paid/],
  ])("needs a method exactly when something is paid %#", (spec, msg) => {
    expect(() => parseBillSpec(spec)).toThrow(msg);
  });

});

describe("getBill", () => {
  it("returns null for an unknown bill number", async () => {
    const client = fakeSupabase({ "bills.select": { data: null, error: null } });
    await expect(getBill(client, { billNumber: "fy26-000999" })).resolves.toBeNull();
    expect(client.calls[0].filters).toEqual([["eq", "bill_number", "FY26-000999"]]);
  });

  it("joins items, payments, customer, method, location, slip photos and current stock", async () => {
    const client = fakeSupabase({
      ...db(),
      "bills.select": { data: { billid: 900, bill_number: "FY26-000336", customerid: 453, salesmethodid: 1, saleslocationid: 1 }, error: null },
      "bill_items.select": { data: [{ bill_item_id: 1, variantid: VID, quantity: 1 }], error: null },
      "bill_payments.select": { data: [], error: null },
      "salesmethods.select": { data: { methodname: "Cash" }, error: null },
      "saleslocations.select": { data: { locationname: "Walk-In" }, error: null },
      "bill_slip_photos.select": { data: [{ id: "a1", billid: 900, path: "900/a1.jpg" }], error: null },
    });
    const b = await getBill(client, { billid: 900 });
    expect(b).toMatchObject({
      bill_number: "FY26-000336",
      payment_method: "Cash",
      location: "Walk-In",
      customer: { first_name: "Test" },
      items: [{ bill_item_id: 1, color: "Mustard", size: "FREE-SIZE", current_stock: 1 }],
      payments: [],
      slip_photos: [{ id: "a1", path: "900/a1.jpg" }],
    });
  });

  it("needs an id or number", async () => {
    await expect(getBill(fakeSupabase(), {})).rejects.toThrow(BillInputError);
  });
});

describe("findBills", () => {
  const bills = [{ billid: 900, bill_number: "FY26-000336", orderdate: "2026-10-22T00:00:00", customerid: 453, totalamount: 1800 }];
  const base = {
    "bills.select": { data: bills, error: null },
    "bill_items.select": (call) =>
      call.filters.some((f) => f[0] === "in")
        ? { data: [{ billid: 900, product_code: "BC252051", product_name: "Georgette-Saree", quantity: 1, mrp: 2395, total: 1800 }], error: null }
        : { data: [{ billid: 900 }], error: null },
    "customers.select": (call) =>
      call.filters.some((f) => f[1] === "phone")
        ? { data: [{ customerid: 453 }], error: null }
        : { data: [{ customerid: 453, first_name: "Test", last_name: "Customer", phone: "+919000000001" }], error: null },
  };

  it("finds a customer's bills by phone in a date range, with their lines", async () => {
    const client = fakeSupabase(base);
    const out = await findBills(client, { phone: "9000000001", from: "2026-10-01", to: "2026-10-31" });
    expect(out).toEqual([
      expect.objectContaining({
        bill_number: "FY26-000336",
        customer: expect.objectContaining({ first_name: "Test" }),
        items: [{ product_code: "BC252051", product_name: "Georgette-Saree", quantity: 1, mrp: 2395, total: 1800 }],
      }),
    ]);
    const billQuery = client.calls.find((c) => c.table === "bills");
    expect(billQuery.filters).toEqual([
      ["eq", "customerid", 453],
      ["gte", "orderdate", "2026-10-01"],
      ["lte", "orderdate", "2026-10-31T23:59:59"],
    ]);
  });

  it("narrows to bills containing a product code", async () => {
    const client = fakeSupabase(base);
    await findBills(client, { productCode: "bc-252051" });
    expect(client.calls[0]).toMatchObject({ table: "bill_items", filters: [["eq", "product_code", "BC252051"]] });
    expect(client.calls.find((c) => c.table === "bills").filters).toEqual([["in", "billid", [900]]]);
  });

  it("returns [] for an unknown phone without querying bills", async () => {
    const client = fakeSupabase({ ...base, "customers.select": { data: [], error: null } });
    await expect(findBills(client, { phone: "9999999999" })).resolves.toEqual([]);
    expect(client.calls.some((c) => c.table === "bills")).toBe(false);
  });

  it.each([
    [{}, /at least one filter/],
    [{ from: "22/10/2026" }, /from: expected YYYY-MM-DD/],
  ])("rejects bad filters %#", async (f, msg) => {
    await expect(findBills(fakeSupabase(base), f)).rejects.toThrow(msg);
  });
});

describe("readable bill spec", () => {
  const MAROON = { variantid: "m1", productid: "BC25051", size: "FREE-SIZE", color: "Maroon", stock: 1 };
  const GOLDEN = { variantid: "g1", productid: "BC25051", size: "FREE-SIZE", color: "Golden", stock: 1 };
  const MUSTARD = { variantid: VID, productid: "BC252051", size: "FREE-SIZE", color: "Mustard", stock: 1 };
  const test = { customerid: 453, first_name: "Test", last_name: "Customer", phone: "+919000000001" };
  const spec = (o = {}) => ({
    customer: { phone: "9000000001" },
    date: "2026-10-22",
    payment: { method: "Cash", amount: 1800 },
    items: [{ product: "BC-252051", qty: 1, amount: 1800 }],
    ...o,
  });
  // A new customer's preview also looks for customers with the same name (ilike): none here.
  const noNameMatch = (fake) => (call) => (call.filters.some((f) => f[0] === "ilike") ? { data: [], error: null } : fake(call));
  const rdb = (o = {}) =>
    db({
      "customers.select": noNameMatch((call) =>
        call.filters.some((f) => f[1] === "phone") ? { data: [test], error: null } : { data: test, error: null }),
      "productsizecolors.select": { data: [MUSTARD, MAROON, GOLDEN], error: null },
      "products.select": {
        data: [
          { productid: "BC252051", name: "Georgette-Saree", categoryid: "SA", retailprice: 2395, unit_type: "piece" },
          { productid: "BC25051", name: "Sambhalpuri Cotton-Saree", categoryid: "SA", retailprice: 2395, unit_type: "piece" },
        ],
        error: null,
      },
      "categories.select": { data: { categoryid: "ACC" }, error: null },
      "rpc.get_max_manual_item_suffix": { data: 26128, error: null },
      ...o,
    });
  const noPhoneMatch = {
    "customers.select": (call) => (call.filters.some((f) => f[1] === "phone") ? { data: [], error: null } : { data: null, error: null }),
  };

  it("finds the customer by phone and the variant by product code", async () => {
    const p = await prepareBill(fakeSupabase(rdb()), spec());
    expect(p.bill.customerid).toBe(453);
    expect(p.bill_items[0]).toMatchObject({ variantid: VID, product_code: "BC252051" });
    expect(p.creates).toEqual({ customer: null, manual_items: [] });
  });

  it("picks the variant by colour, case-insensitively", async () => {
    const p = await prepareBill(fakeSupabase(rdb()), spec({ items: [{ product: "BC25051", color: "maroon", qty: 1, amount: 1800 }] }));
    expect(p.bill_items[0].variantid).toBe("m1");
  });

  it.each([
    [{ product: "BC25051", qty: 1 }, /BC25051 has 2 matching variants, add color\/size; variants: Maroon\/FREE-SIZE \(stock 1\), Golden/],
    [{ product: "BC25051", color: "Pink", qty: 1 }, /BC25051 has no variant Pink; variants:/],
    [{ product: "BC999", qty: 1 }, /no product BC999/],
    [{ variantid: VID, color: "Mustard", qty: 1 }, /color\/size only go with product/],
    [{ product: "BC252051", colour: "Mustard", qty: 1 }, /unknown field\(s\) colour/],
  ])("refuses an unclear or misspelt line %#", async (item, msg) => {
    await expect(prepareBill(fakeSupabase(rdb()), spec({ items: [item] }))).rejects.toThrow(msg);
  });

  it.each([
    // The product's only size fills in a size the line leaves out.
    [{ product: "BC25051", color: "Pink", qty: 1 }, "stock add --code BC25051 --size 'FREE-SIZE' --color 'Pink' --qty 1 --new-variant"],
    [{ product: "BC25051", color: "Pink", size: "XL|42", qty: 2 }, "stock add --code BC25051 --size 'XL|42' --color 'Pink' --qty 2 --new-variant"],
    // More than one colour: left for the operator to fill in.
    [{ product: "BC25051", size: "M", qty: 1 }, "stock add --code BC25051 --size 'M' --color '<color>' --qty 1 --new-variant"],
  ])("says which stock add command would create a missing variant %#", async (item, command) => {
    await expect(prepareBill(fakeSupabase(rdb()), spec({ items: [item] }))).rejects.toThrow(`If the piece is on the shelf, add it: ${command}`);
  });

  it("refuses an unknown phone unless asked to create the customer", async () => {
    await expect(prepareBill(fakeSupabase(rdb(noPhoneMatch)), spec())).rejects.toThrow(
      /No customer with phone 9000000001; add customer.create_if_missing/,
    );
  });

  it("plans a new customer for an unknown phone with create_if_missing", async () => {
    const p = await prepareBill(
      fakeSupabase(rdb(noPhoneMatch)),
      spec({ customer: { phone: "9000000001", create_if_missing: { first: "Test", last: "Customer" } } }),
    );
    expect(p.bill.customerid).toBeNull();
    expect(p.creates.customer).toMatchObject({ first_name: "Test", last_name: "Customer", phone: "+919000000001", is_guest: false });
  });

  it("warns of likely duplicates when it would create a customer: same name, or phone one digit off", async () => {
    const sameName = { customerid: 41, first_name: "test", last_name: "CUSTOMER", phone: "+919811111111" };
    const nearPhone = { customerid: 42, first_name: "Ravi", last_name: null, phone: "+919000000007" };
    const client = fakeSupabase(rdb({
      "customers.select": (call) => {
        if (call.filters.some((f) => f[0] === "ilike")) return { data: [sameName], error: null };
        if (call.filters.some((f) => f[0] === "in" && f[1] === "phone")) return { data: [nearPhone], error: null };
        return { data: [], error: null };
      },
    }));
    const p = await prepareBill(
      client,
      spec({ customer: { phone: "9000000001", create_if_missing: { first: "Test", last: "Customer" } } }),
    );
    expect(p.creates.customer).toMatchObject({ phone: "+919000000001" });
    expect(p.warnings).toEqual([
      "Possible duplicate: customer 41 (test CUSTOMER, +919811111111) has the same name; if it is them, bill customer { id: 41 } instead of creating a new customer",
      "Possible duplicate: customer 42 (Ravi, +919000000007) has a phone one digit off +919000000001; check the slip's phone",
    ]);
    const byName = client.calls.find((c) => c.filters.some((f) => f[0] === "ilike"));
    expect(byName.filters).toEqual([["ilike", "first_name", "Test"], ["ilike", "last_name", "Customer"]]);
    const byPhone = client.calls.find((c) => c.table === "customers" && c.filters.some((f) => f[0] === "in"));
    expect(byPhone.filters[0][2]).toHaveLength(90);
    expect(client.calls.every((c) => c.op === "select")).toBe(true);
  });

  it("looks for no duplicates when the customer already exists", async () => {
    const client = fakeSupabase(rdb());
    await prepareBill(client, spec({ customer: { phone: "9000000001", create_if_missing: { first: "Test", last: "Customer" } } }));
    expect(client.calls.filter((c) => c.table === "customers")).toHaveLength(1);
  });

  it("keeps the duplicate warnings in bill create's output", async () => {
    const client = fakeSupabase(rdb({
      "customers.select": (call) => {
        if (call.filters.some((f) => f[0] === "ilike")) return { data: [{ customerid: 41, first_name: "W", last_name: null, phone: null }], error: null };
        return { data: { customerid: 500, first_name: "W" }, error: null };
      },
      "customers.insert": (call) => ({ data: { customerid: 500, ...call.row }, error: null }),
      "rpc.bill_save": { data: { billid: 901, bill_number: "FY26-000337" }, error: null },
    }));
    const out = await createBill(client, spec({ customer: { create: { first: "W" } } }));
    expect(out.warnings).toEqual([expect.stringMatching(/^Possible duplicate: customer 41 \(W, no phone\) has the same name/)]);
  });

  it("warns when the phone belongs to someone with another name", async () => {
    const p = await prepareBill(fakeSupabase(rdb()), spec({ customer: { phone: "9000000001", create_if_missing: { first: "Asha" } } }));
    expect(p.bill.customerid).toBe(453);
    expect(p.warnings).toEqual([expect.stringMatching(/is customer 453 \(Test Customer\), not "Asha"/)]);
  });

  it("plans a guest customer and consecutive ids for new manual items", async () => {
    const p = await prepareBill(
      fakeSupabase(rdb()),
      spec({
        customer: { create: { first: "Walk", last: "In" } },
        payment: { method: "Cash", amount: 250 },
        items: [
          { manual_item: { create: { name: "Fall", category: "ACC", mrp: 150, cost: "ZEZ" } }, qty: 1 },
          { manual_item: { create: { name: "Pico", category: "ACC", mrp: 100, cost: "ZDZ" } }, qty: 1 },
        ],
      }),
    );
    expect(p.creates.customer).toMatchObject({ first_name: "Walk", phone: null, is_guest: true });
    expect(p.creates.manual_items.map((m) => m.manual_item_id)).toEqual(["BCX26129", "BCX26130"]);
    expect(p.bill_items.map((i) => [i.product_code, i.cost_price, i.total])).toEqual([
      ["BCX26129", 50, 150],
      ["BCX26130", 40, 100],
    ]);
  });

  it("creates a new manual item with its line's quantity as stock, so the sale leaves 0", async () => {
    const p = await prepareBill(
      fakeSupabase(rdb()),
      spec({
        payment: { method: "Cash", amount: 250 },
        items: [{ manual_item: { create: { name: "Cotton", category: "ACC", mrp: 100, cost: "ZEZ" } }, qty: 2.5 }],
      }),
    );
    expect(p.creates.manual_items[0]).toMatchObject({ manual_item_id: "BCX26129", stock: 2.5 });
    expect(p.stock).toEqual([{ manual_item_id: "BCX26129", name: "Cotton", stock_before: 2.5, change: -2.5, stock_after: 0 }]);
  });

  it("reports a bad inline manual item against its line", async () => {
    await expect(
      prepareBill(fakeSupabase(rdb()), spec({ items: [{ manual_item: { create: { name: "Fall", category: "ACC", mrp: 150, cost: "ZZ" } }, qty: 1 }] })),
    ).rejects.toThrow(/items\[0\].manual_item.create: A valid cost is required/);
  });

  it("creates the customer and manual item first, then bills them by id", async () => {
    const client = fakeSupabase(
      rdb({
        ...noPhoneMatch,
        "customers.select": noNameMatch((call) =>
          call.filters.some((f) => f[1] === "phone")
            ? { data: [], error: null }
            : { data: { customerid: 500, first_name: "Test", last_name: "Customer", phone: "+919000000001" }, error: null }),
        "customers.insert": (call) => ({ data: { customerid: 500, ...call.row }, error: null }),
        "manual_items.select": (call) => ({
          data: [{ manual_item_id: "BCX26129", name: "Fall", categoryid: "ACC", size: null, color: null, purchase_price: 50, mrp: 150, stock: 1 }],
          error: null,
        }),
        "manual_items.insert": (call) => ({ data: { ...call.row, stock: 1 }, error: null }),
        "rpc.bill_save": { data: { billid: 901, bill_number: "FY26-000337" }, error: null },
        "activity_log.insert": { data: null, error: null },
      }),
    );
    const out = await createBill(
      client,
      spec({
        customer: { phone: "9000000001", create_if_missing: { first: "Test", last: "Customer" } },
        payment: { method: "Cash", amount: 1950 },
        items: [
          { product: "BC252051", qty: 1, amount: 1800 },
          { manual_item: { create: { name: "Fall", category: "ACC", mrp: 150, cost: "ZEZ" } }, qty: 1 },
        ],
      }),
    );
    const writes = client.calls.filter((c) => !["select", "rpc"].includes(c.op) || c.fn === "bill_save").map((c) => c.fn ?? `${c.table}.${c.op}`);
    expect(writes).toEqual([
      "customers.insert", "activity_log.insert", "manual_items.insert", "bill_save", "activity_log.insert",
    ]);
    expect(client.calls.find((c) => c.table === "manual_items" && c.op === "insert").row).toMatchObject({ stock: 1 });
    const { p_payload: payload } = client.calls.find((c) => c.fn === "bill_save").args;
    expect(payload.bill.customerid).toBe(500);
    expect(payload.items.map((r) => r.product_code)).toEqual(["BC252051", "BCX26129"]);
    expect(out).toMatchObject({ bill_number: "FY26-000337", created: { customer: { customerid: 500 }, manual_items: [{ manual_item_id: "BCX26129" }] } });
  });

  it("says what was already created when the bill then fails", async () => {
    const client = fakeSupabase(
      rdb({
        "customers.select": noNameMatch((call) => (call.filters.some((f) => f[1] === "phone") ? { data: [], error: null } : { data: { customerid: 500, first_name: "W" }, error: null })),
        "customers.insert": (call) => ({ data: { customerid: 500, ...call.row }, error: null }),
        "rpc.bill_save": { data: null, error: new Error("db down") },
      }),
    );
    await expect(createBill(client, spec({ customer: { create: { first: "W" } } }))).rejects.toThrow(
      /Failed to save bill: db down — NOTE: customer 500 were already created; re-run with customer \{ id \}/,
    );
  });
});

describe("salespersons", () => {
  // Fake staff names; the shop's real ones live only in the salespersons table.
  const staff = [
    { salesperson_id: 10, name: "Asha", active: true },
    { salesperson_id: 20, name: "Bina", active: true },
    { salesperson_id: 30, name: "Chandni", active: false },
  ];
  const withStaff = (overrides = {}) => db({ "salespersons.select": { data: staff, error: null }, ...overrides });

  it.each([
    [{ ...slip387, salespersons: "Asha" }, /salespersons must be a list/],
    [{ ...slip387, salespersons: [""] }, /salespersons\[0\]: expected a name or id/],
    [{ ...slip387, salespersons: [{ name: "Asha" }] }, /salespersons\[0\]: expected a name or id/],
    [{ ...slip387, salespersons: [1.5] }, /salespersons\[0\]: expected a name or id/],
  ])("rejects a malformed salespersons list %#", (spec, msg) => {
    expect(() => parseBillSpec(spec)).toThrow(msg);
  });

  it("matches names case-insensitively and accepts ids, in spec order without repeats", () => {
    expect(resolveSalespersons(staff, ["bina", "ASHA", 20, "10"])).toEqual([
      { salesperson_id: 20, name: "Bina" },
      { salesperson_id: 10, name: "Asha" },
    ]);
  });

  it.each([
    [["Dev"], /Unknown salesperson "Dev" \(one of: Asha \(10\), Bina \(20\)\)/],
    [[99], /Unknown salesperson id 99/],
    [["chandni"], /Chandni \(30\) is not active/],
  ])("refuses an unknown or inactive salesperson %#", (refs, msg) => {
    expect(() => resolveSalespersons(staff, refs)).toThrow(BillInputError);
    expect(() => resolveSalespersons(staff, refs)).toThrow(msg);
  });

  it("refuses a name two active salespersons share, and prefers the active one over a former one", () => {
    const twins = [...staff, { salesperson_id: 40, name: "asha", active: true }];
    expect(() => resolveSalespersons(twins, ["Asha"])).toThrow(/matches ids 10, 40; give the id/);
    const rehired = [...staff, { salesperson_id: 50, name: "Asha", active: false }];
    expect(resolveSalespersons(rehired, ["Asha"])).toEqual([{ salesperson_id: 10, name: "Asha" }]);
  });

  it("preview shows the resolved salespersons and stays read-only", async () => {
    const client = fakeSupabase(withStaff());
    const p = await prepareBill(client, { ...slip387, salespersons: ["asha", "Bina"] });
    expect(p.salespersons).toEqual([
      { salesperson_id: 10, name: "Asha" },
      { salesperson_id: 20, name: "Bina" },
    ]);
    // Bill-level only, as the screen's selector: lines keep no salesperson.
    expect(p.bill_items.every((i) => i.salesperson_id === null)).toBe(true);
    expect(p.bill).not.toHaveProperty("salesperson_ids");
    expect(client.calls.every((c) => c.op === "select")).toBe(true);
  });

  it("an unknown name fails the preview with BillInputError", async () => {
    await expect(prepareBill(fakeSupabase(withStaff()), { ...slip387, salespersons: ["Dev"] })).rejects.toThrow(BillInputError);
  });

  it("without salespersons the table is not read and the preview lists none", async () => {
    const client = fakeSupabase(withStaff());
    const p = await prepareBill(client, slip387);
    expect(p.salespersons).toEqual([]);
    expect(client.calls.some((c) => c.table === "salespersons")).toBe(false);
  });

  it("sends salesperson_ids to bill_save, which writes bill_salespersons as for the screen", async () => {
    const client = fakeSupabase(withStaff({
      "rpc.bill_save": { data: { billid: 900, bill_number: "FY26-000336" }, error: null },
      "activity_log.insert": { data: null, error: null },
    }));
    const out = await createBill(client, { ...slip387, salespersons: ["Bina", "asha"] });
    const writes = client.calls.filter((c) => c.op !== "select").map((c) => c.fn ?? `${c.table}.${c.op}`);
    expect(writes).toEqual(["bill_save", "activity_log.insert"]);
    const { p_payload } = client.calls.find((c) => c.fn === "bill_save").args;
    expect(p_payload.salesperson_ids).toEqual([20, 10]);
    expect(p_payload.items.every((i) => i.salesperson_id === null)).toBe(true);
    expect(out.salespersons).toEqual([
      { salesperson_id: 20, name: "Bina" },
      { salesperson_id: 10, name: "Asha" },
    ]);
  });

  it("sends no salesperson_ids when the spec has none, as before", async () => {
    const client = fakeSupabase(withStaff({ "rpc.bill_save": { data: { billid: 900, bill_number: "FY26-000336" }, error: null } }));
    await createBill(client, { ...slip387, salespersons: [] });
    expect(client.calls.find((c) => c.fn === "bill_save").args.p_payload).not.toHaveProperty("salesperson_ids");
  });

  it("bill get lists the bill's salespersons by name", async () => {
    const client = fakeSupabase({
      "bills.select": { data: { billid: 900, bill_number: "FY26-000336" }, error: null },
      "bill_salespersons.select": {
        data: [{ salesperson_id: 10, salespersons: { name: "Asha" } }, { salesperson_id: 20, salespersons: { name: "Bina" } }],
        error: null,
      },
    });
    const b = await getBill(client, { billid: 900 });
    expect(b.salespersons).toEqual([
      { salesperson_id: 10, name: "Asha" },
      { salesperson_id: 20, name: "Bina" },
    ]);
    expect(client.calls.find((c) => c.table === "bill_salespersons").filters).toEqual([["eq", "billid", 900]]);
  });
});

describe("draft bills (spec draft: true)", () => {
  // A slip marked "not confirmed yet": saved as the billing screen's Save Draft on a new bill.
  const draft = { ...slip387, draft: true };
  const saved = { billid: 902, bill_number: "FY26-000338" };
  const staff = [{ salesperson_id: 10, name: "Asha", active: true }];
  const draftDb = (overrides = {}) => db({
    "salespersons.select": { data: staff, error: null },
    "bills.insert": { data: saved, error: null },
    "bill_items.insert": { data: null, error: null },
    "bill_salespersons.insert": { data: null, error: null },
    "rpc.stock_adjust": { data: 0, error: null },
    "activity_log.insert": { data: null, error: null },
    ...overrides,
  });
  const writesOf = (client) => client.calls.filter((c) => c.op !== "select").map((c) => c.fn ?? `${c.table}.${c.op}`);

  it("accepts draft true/false and refuses anything else", () => {
    expect(parseBillSpec(draft).draft).toBe(true);
    expect(parseBillSpec(slip387).draft).toBe(false);
    expect(() => parseBillSpec({ ...slip387, draft: "yes" })).toThrow(/draft must be true or false/);
  });

  it("allows what Save Draft allows: no customer, no payment, an amount without a method", async () => {
    const { customerid, payment, ...bare } = draft;
    const s = parseBillSpec(bare);
    expect(s.customer).toEqual({ kind: "none" });
    expect(s.payment).toEqual({ method: "", amount: null, balance_due: 0 });
    expect(parseBillSpec({ ...draft, payment: { amount: 500 } }).payment).toEqual({ method: "", amount: 500, balance_due: 0 });
    // The same specs are refused for a finalized bill.
    expect(() => parseBillSpec({ ...bare, draft: false })).toThrow(/customer is required/);
    expect(() => parseBillSpec({ ...slip387, payment: { amount: 500 } })).toThrow(/payment.method is required/);

    const p = await prepareBill(fakeSupabase(draftDb()), bare);
    expect(p.customer).toBeNull();
    expect(p.bill).toMatchObject({ customerid: null, payment_amount: null, salesmethodid: null, final_amount: null });
  });

  it.each([
    [{ ...draft, payment: { method: "Cash", amount: -1 } }, /payment.amount must be >= 0/],
    [{ ...draft, payment: { amount: 0, balance_due: -5 } }, /balance_due must be >= 0/],
    [{ ...draft, payment: "cash" }, /payment must be an object/],
    [{ ...draft, payment: { method: "Cash", amount: 1800, tip: 5 } }, /unknown field\(s\) tip/],
  ])("still rejects a malformed draft payment %#", (spec, msg) => {
    expect(() => parseBillSpec(spec)).toThrow(msg);
  });

  it("still refuses an unknown payment method on a draft", async () => {
    await expect(prepareBill(fakeSupabase(draftDb()), { ...draft, payment: { method: "Barter" } })).rejects.toThrow(/Unknown payment method "Barter"/);
  });

  it("preview builds the row the screen inserts for a draft, without the payment check, and writes nothing", async () => {
    const client = fakeSupabase(draftDb());
    // 1600 paid is ₹200 off the total: refused for a finalized bill, saved as entered for a draft.
    const p = await prepareBill(client, { ...draft, payment: { method: "Cash", amount: 1600 } });
    expect(client.calls.every((c) => c.op === "select")).toBe(true);
    expect(p.status).toBe("draft");
    expect(p.bill).toEqual({
      customerid: 453,
      stock_reduced: true,
      notes: null,
      document_type: "bos",
      // Line totals as they stand: no balance discount until the draft is finished.
      totalamount: 1800.08,
      gst_total: 0,
      discount_total: 594.92,
      taxable_total: 1800.08,
      paymentstatus: "draft",
      finalized: false,
      applied_codes: [],
      payment_amount: 1600,
      final_amount: null,
      saleslocationid: 1,
      salesmethodid: 1,
      orderdate: "2026-10-22T00:00:00+05:30",
    });
    expect(p.totals).toEqual({ mrp_total: 2395, line_discounts: 594.92, balance_discount: 0, grand_total: 1800.08, paid: 1600 });
    expect(p.bill_items).toEqual([expect.objectContaining({ billid: null, variantid: VID, quantity: 1, total: 1800.08 })]);
    expect(p.first_payment).toBeNull();
    expect(p.stock[0]).toMatchObject({ change: -1, stock_after: 0 });
  });

  it("a finalized bill's preview says finalized and differs from the draft only where the screen does", async () => {
    const fin = await prepareBill(fakeSupabase(draftDb()), slip387);
    const dr = await prepareBill(fakeSupabase(draftDb()), draft);
    expect(fin.status).toBe("finalized");
    expect(fin.bill).toMatchObject({ paymentstatus: "finalized", finalized: true, totalamount: 1800 });
    expect(dr.bill).toMatchObject({ paymentstatus: "draft", finalized: false, totalamount: 1800.08 });
    // The money columns bill_save sets are left to their defaults on a draft insert, as the screen does.
    expect(dr.bill).not.toHaveProperty("store_credit_used");
    expect(dr.bill).not.toHaveProperty("exchange_credit_used");
  });

  it("records balance_due as the screen's final amount", async () => {
    const p = await prepareBill(fakeSupabase(draftDb()), { ...draft, payment: { method: "Cash", amount: 500, balance_due: 1300 } });
    expect(p.bill).toMatchObject({ payment_amount: 500, final_amount: 1800 });
    expect(p.totals.balance_due).toBe(1300);
  });

  it("refuses short stock, as Save Draft does, unless skip_stock", async () => {
    const stock0 = draftDb({
      "productsizecolors.select": { data: [{ variantid: VID, productid: "BC252051", size: "FREE-SIZE", color: "Mustard", stock: 0 }], error: null },
    });
    await expect(prepareBill(fakeSupabase(stock0), draft)).rejects.toThrow(/Insufficient stock/);
    const p = await prepareBill(fakeSupabase(stock0), { ...draft, skip_stock: true });
    expect(p.bill.stock_reduced).toBe(false);
  });

  it("saves bills row, items, salespersons, then stock and the log, as the screen's Save Draft", async () => {
    const client = fakeSupabase(draftDb());
    const out = await createBill(client, { ...draft, salespersons: ["asha"] });
    expect(writesOf(client)).toEqual([
      "bills.insert",
      "bill_items.insert",
      "bill_salespersons.insert",
      "stock_adjust",
      "activity_log.insert",
    ]);
    // Not bill_save: it has no op for a new draft.
    expect(client.calls.some((c) => c.fn === "bill_save")).toBe(false);
    const billRow = client.calls.find((c) => c.table === "bills" && c.op === "insert").row;
    expect(billRow).toMatchObject({ paymentstatus: "draft", finalized: false, stock_reduced: true });
    // The trigger numbers the bill; the CLI never sends one.
    expect(billRow).not.toHaveProperty("bill_number");
    expect(client.calls.find((c) => c.table === "bill_items").row).toEqual([
      expect.objectContaining({ billid: 902, variantid: VID, quantity: 1 }),
    ]);
    expect(client.calls.find((c) => c.table === "bill_salespersons").row).toEqual([{ billid: 902, salesperson_id: 10 }]);
    expect(client.calls.find((c) => c.fn === "stock_adjust").args).toEqual({
      p_variant: VID, p_delta: -1, p_reason: "bill_draft_create", p_ref: "902",
    });
    expect(client.calls.find((c) => c.table === "activity_log").row.summary).toBe(
      "Created draft bill #FY26-000338 for Test Customer — ₹1,800.08, 1 items (via CLI)",
    );
    expect(out).toMatchObject({ billid: 902, bill_number: "FY26-000338", status: "draft", negative_stock: [] });
    expect(out).not.toHaveProperty("save_errors");
  });

  it("with skip_stock moves no stock and records stock_reduced false", async () => {
    const client = fakeSupabase(draftDb());
    await createBill(client, { ...draft, skip_stock: true });
    expect(writesOf(client)).toEqual(["bills.insert", "bill_items.insert", "activity_log.insert"]);
    expect(client.calls.find((c) => c.table === "bills").row.stock_reduced).toBe(false);
  });

  it("logs a draft with no customer as walk-in", async () => {
    const { customerid, ...walkIn } = draft;
    const client = fakeSupabase(draftDb());
    const out = await createBill(client, walkIn);
    expect(out.customer).toBeNull();
    expect(client.calls.find((c) => c.table === "activity_log").row.summary).toMatch(/for walk-in —/);
  });

  it("removes the bills row again when its items fail, as the screen does", async () => {
    const client = fakeSupabase(draftDb({ "bill_items.insert": { data: null, error: { message: "items boom" } } }));
    await expect(createBill(client, draft)).rejects.toThrow("Failed to save bill items: items boom");
    expect(writesOf(client)).toEqual(["bills.insert", "bill_items.insert", "bills.delete"]);
    expect(client.calls.find((c) => c.op === "delete").filters).toEqual([["eq", "billid", 902]]);
  });

  it("says so when the cleanup delete fails too", async () => {
    const client = fakeSupabase(draftDb({
      "bill_items.insert": { data: null, error: { message: "items boom" } },
      "bills.delete": { data: null, error: { message: "delete boom" } },
    }));
    await expect(createBill(client, draft)).rejects.toThrow(/draft FY26-000338 \(billid 902\) could not be removed: delete boom/);
  });

  it("keeps the draft and lists a salespersons or stock failure in save_errors", async () => {
    const client = fakeSupabase(draftDb({
      "bill_salespersons.insert": { data: null, error: { message: "sp boom" } },
      "rpc.stock_adjust": { data: null, error: { message: "stock boom" } },
    }));
    const out = await createBill(client, { ...draft, salespersons: ["Asha"] });
    expect(out.billid).toBe(902);
    expect(out.save_errors).toEqual([
      expect.stringMatching(/Salespersons not saved \(sp boom\)/),
      expect.stringMatching(/Stock not reduced for BC252051 Mustard\/FREE-SIZE \(stock boom\)/),
    ]);
  });

  it("reports a variant the stock change took below zero", async () => {
    const client = fakeSupabase(draftDb({ "rpc.stock_adjust": { data: -1, error: null } }));
    const out = await createBill(client, draft);
    expect(out.negative_stock).toEqual([{ variantid: VID, stock: -1 }]);
  });

  it("takes a manual line's stock through manual_item_stock_adjust, as the screen's Save Draft", async () => {
    const client = fakeSupabase(draftDb({ "rpc.manual_item_stock_adjust": { data: 0, error: null } }));
    const out = await createBill(client, {
      ...draft,
      payment: { method: "Cash", amount: 1950 },
      items: [...draft.items, { manual_item_id: "BCX26129", qty: 1 }],
    });
    expect(client.calls.find((c) => c.fn === "manual_item_stock_adjust").args).toEqual({
      p_manual_item_id: "BCX26129", p_delta: -1, p_reason: "bill_draft_create", p_ref: "902",
    });
    expect(client.calls.find((c) => c.fn === "stock_adjust").args.p_variant).toBe(VID);
    expect(out.negative_stock).toEqual([]);
    expect(out).not.toHaveProperty("save_errors");
  });

  it("lists a manual-item stock failure or a manual item below zero", async () => {
    const spec = { ...draft, payment: { method: "Cash", amount: 1950 }, items: [...draft.items, { manual_item_id: "BCX26129", qty: 1 }] };
    const failed = await createBill(fakeSupabase(draftDb({ "rpc.manual_item_stock_adjust": { data: null, error: { message: "mi boom" } } })), spec);
    expect(failed.save_errors).toEqual([expect.stringMatching(/Stock not reduced for manual item BCX26129 \(mi boom\)/)]);
    const below = await createBill(fakeSupabase(draftDb({ "rpc.manual_item_stock_adjust": { data: -1, error: null } })), spec);
    expect(below.negative_stock).toEqual([{ manual_item_id: "BCX26129", stock: -1 }]);
  });

  it("dry run writes nothing", async () => {
    const client = fakeSupabase(draftDb());
    const out = await createBill(client, draft, { dryRun: true });
    expect(out).toMatchObject({ dry_run: true, status: "draft" });
    expect(client.calls.every((c) => c.op === "select")).toBe(true);
  });

  it("bill get marks a draft", async () => {
    const draftRow = { billid: 902, bill_number: "FY26-000338", paymentstatus: "draft", finalized: false };
    expect((await getBill(fakeSupabase({ "bills.select": { data: draftRow, error: null } }), { billid: 902 })).is_draft).toBe(true);
    const finRow = { ...draftRow, paymentstatus: "finalized", finalized: true };
    expect((await getBill(fakeSupabase({ "bills.select": { data: finRow, error: null } }), { billid: 902 })).is_draft).toBe(false);
  });
});

describe("checkBillAgainstSpec (slip finish)", () => {
  // Slip 387 as getBill returns it once saved; orderdate comes back in UTC.
  const saved = (o = {}) => ({
    billid: 900,
    bill_number: "FY26-000336",
    customerid: 453,
    orderdate: "2026-10-21T18:30:00+00:00",
    paymentstatus: "finalized",
    totalamount: 1800,
    payment_amount: 1800,
    payment_method: "Cash",
    customer: { customerid: 453, first_name: "Test", last_name: "Customer", phone: "+919000000001" },
    salespersons: [{ salesperson_id: 10, name: "Asha" }],
    items: [{ product_code: "BC252051", variantid: VID, quantity: 1, mrp: 2395, total: 1800, alteration_charge: 0, color: "Mustard", size: "FREE-SIZE" }],
    ...o,
  });
  const spec = {
    customer: { phone: "9000000001" },
    date: "2026-10-22",
    payment: { method: "Cash", amount: 1800 },
    salespersons: ["asha"],
    items: [{ product: "BC-252051", color: "mustard", qty: 1, amount: 1800 }],
  };

  it("passes a bill saved as the spec says, with a compact view of it", () => {
    expect(checkBillAgainstSpec(spec, saved())).toEqual({
      ok: true,
      mismatches: [],
      saved: {
        bill_number: "FY26-000336",
        status: "finalized",
        customer: { customerid: 453, name: "Test Customer", phone: "+919000000001" },
        date: "2026-10-22",
        lines: [{ code: "BC252051", color: "Mustard", size: "FREE-SIZE", qty: 1, amount: 1800 }],
        total: 1800,
        paid: 1800,
        method: "Cash",
        salespersons: ["Asha"],
      },
    });
  });

  it("allows the balance discount spread over the lines, but not amounts on the wrong line", () => {
    // Lines 1000 + 960 on a 1950 payment: the ₹10 balance discount is shared in proportion.
    const twoLines = { ...spec, payment: { method: "Cash", amount: 1950 }, items: [
      { variantid: "a", qty: 1, amount: 1000 },
      { variantid: "b", qty: 1, amount: 960 },
    ] };
    const items = (t1, t2) => [
      { product_code: "BC1", variantid: "a", quantity: 1, mrp: 1200, total: t1, alteration_charge: 0 },
      { product_code: "BC2", variantid: "b", quantity: 1, mrp: 1200, total: t2, alteration_charge: 0 },
    ];
    expect(checkBillAgainstSpec(twoLines, saved({ totalamount: 1950, payment_amount: 1950, items: items(994.9, 955.1) })).ok).toBe(true);
    const swapped = checkBillAgainstSpec(twoLines, saved({ totalamount: 1950, payment_amount: 1950, items: items(955.1, 994.9) }));
    expect(swapped.mismatches).toEqual([
      "items[0] amount: spec 1000, bill 955.1",
      "items[1] amount: spec 960, bill 994.9",
    ]);
  });

  it("lists every field that differs", () => {
    const wrong = saved({
      orderdate: "2026-10-22T18:30:00+00:00",
      totalamount: 1700,
      payment_amount: 1700,
      payment_method: "UPI",
      customer: { customerid: 454, first_name: "Other", last_name: null, phone: "+919000000009" },
      salespersons: [],
      items: [{ product_code: "BC252051", variantid: "x", quantity: 2, mrp: 2395, total: 1700, alteration_charge: 0, color: "Maroon", size: "FREE-SIZE" }],
    });
    expect(checkBillAgainstSpec(spec, wrong).mismatches).toEqual([
      'customer phone: spec "+919000000001", bill "+919000000009"',
      'date: spec "2026-10-22", bill "2026-10-23"',
      'items[0] color: spec "mustard", bill "Maroon"',
      "items[0] qty: spec 1, bill 2",
      "items[0] amount: spec 1800, bill 1700",
      "total: spec 1800, bill 1700",
      "paid: spec 1800, bill 1700",
      'method: spec "Cash", bill "UPI"',
      'salespersons: spec ["asha"], bill []',
    ]);
  });

  it("checks status, line count and a customer by id", () => {
    const out = checkBillAgainstSpec({ ...slip387, payment: { method: "Cash", amount: 1000, balance_due: 800 } }, saved({ customerid: 9, items: [] }));
    expect(out.ok).toBe(false);
    expect(out.mismatches).toEqual(expect.arrayContaining([
      "customer: spec 453, bill 9",
      'status: spec "partial", bill "finalized"',
      "lines: spec 1, bill 0",
      "paid: spec 1000, bill 1800",
    ]));
  });

  it("does not hold a draft to the amount paid", () => {
    const draft = { ...slip387, draft: true, payment: { method: "Cash", amount: 500 } };
    const bill = saved({ paymentstatus: "draft", totalamount: 1800.08, payment_amount: 500, salespersons: [],
      items: [{ product_code: "BC252051", variantid: VID, quantity: 1, mrp: 2395, total: 1800.08, alteration_charge: 0 }] });
    expect(checkBillAgainstSpec(draft, bill)).toMatchObject({ ok: true, mismatches: [] });
  });
});

describe("stock_adds (stock added with the bill)", () => {
  const SHIRT = { productid: "BC25385", name: "Cotton Self-Shirt", categoryid: "SHT", fabric: null, purchaseprice: 567, retailprice: 1495, unit_type: "piece" };
  const writesOf = (client) => client.calls.filter((c) => c.op !== "select").map((c) => c.fn ?? `${c.table}.${c.op}`);
  const filterOf = (call, kind, col) => call.filters?.find((f) => f[0] === kind && f[1] === col)?.[2];
  // The shelf as the database holds it: stock_adjust, insert and delete change it.
  const shelf = ({ billSave, atomicSave, draftInsert, deleteError, undoError } = {}) => {
    const variants = [{ variantid: "v-xl", productid: "BC25385", size: "XL|42", color: "Pink", stock: 0 }];
    const client = fakeSupabase(db({
      "products_admin.select": { data: [SHIRT], error: null },
      "products.select": { data: [SHIRT], error: null },
      "categories.select": { data: [{ categoryid: "SHT", name: "Shirt" }], error: null },
      "sizes.select": { data: [{ code: "XL|42" }, { code: "3XL|46" }], error: null },
      "colors.select": { data: [{ code: "Pink" }], error: null },
      "productsizecolors.select": (call) => {
        const ids = filterOf(call, "in", "variantid");
        const products = filterOf(call, "in", "productid");
        if (ids) return { data: variants.filter((v) => ids.includes(v.variantid)).map((v) => ({ ...v })), error: null };
        if (products) return { data: variants.filter((v) => products.includes(v.productid)).map((v) => ({ ...v })), error: null };
        const [p, s, c] = ["productid", "size", "color"].map((col) => filterOf(call, "eq", col));
        const found = variants.find((v) => v.productid === p && v.size === s && v.color === c);
        return { data: found ? { ...found } : null, error: null };
      },
      "productsizecolors.insert": (call) => {
        variants.push({ ...call.row });
        return { data: null, error: null };
      },
      "productsizecolors.delete": (call) => {
        if (deleteError) return { data: null, error: deleteError };
        const id = filterOf(call, "eq", "variantid");
        variants.splice(variants.findIndex((v) => v.variantid === id), 1);
        return { data: [{ variantid: id }], error: null };
      },
      "rpc.stock_adjust": (call) => {
        if (undoError && call.args.p_delta < 0) return { data: null, error: undoError };
        const v = variants.find((x) => x.variantid === call.args.p_variant);
        v.stock += call.args.p_delta;
        return { data: v.stock, error: null };
      },
      "rpc.bill_save": billSave ?? { data: { billid: 903, bill_number: "FY26-000339", negative_stock: [] }, error: null },
      // One transaction, as the database runs it: on an error nothing it would have added stays.
      "rpc.bill_save_with_stock_adds": (call) => {
        if (atomicSave) return atomicSave;
        for (const a of call.args.p_stock_adds) {
          if (a.create) variants.push({ variantid: a.variantid, productid: a.productid, size: a.size, color: a.color, stock: a.qty });
          else variants.find((v) => v.variantid === a.variantid).stock += a.qty;
        }
        return { data: { billid: 903, bill_number: "FY26-000339", negative_stock: [] }, error: null };
      },
      "bills.insert": draftInsert ?? { data: { billid: 904, bill_number: "FY26-000340" }, error: null },
      "bill_items.insert": { data: null, error: null },
      "activity_log.insert": { data: null, error: null },
    }));
    return { client, variants };
  };
  const shirtSpec = (o = {}) => ({
    customerid: 453,
    date: "2026-10-22",
    payment: { method: "Cash", amount: 1495 },
    items: [{ product: "BC25385", color: "Pink", size: "XL|42", qty: 1 }],
    ...o,
  });
  const addXL = { code: "bc-25385", size: "xl|42", color: "pink", qty: 1 };
  const add3XL = { code: "BC25385", size: "3XL|46", color: "Pink", qty: 1, new_variant: true };
  const shirt3XL = [{ product: "BC25385", color: "Pink", size: "3XL|46", qty: 1 }];
  const failingSave = { data: null, error: { message: "db down" } };

  it.each([
    [{ stock_adds: "BC25385" }, /stock_adds must be a list/],
    [{ stock_adds: [{ ...addXL, colour: "Pink" }] }, /stock_adds\[0\]: unknown field\(s\) colour/],
    [{ stock_adds: [{ ...addXL, size: " " }] }, /stock_adds\[0\].size is required/],
    [{ stock_adds: [{ ...addXL, qty: 0 }] }, /stock_adds\[0\].qty must be > 0/],
    [{ stock_adds: [{ ...addXL, new_variant: "yes" }] }, /stock_adds\[0\].new_variant must be true or false/],
  ])("rejects a malformed stock_adds %#", (patch, msg) => {
    expect(() => parseBillSpec(shirtSpec(patch))).toThrow(msg);
  });

  it("preview checks the bill as if the stock were added, and writes nothing", async () => {
    const { client } = shelf();
    await expect(prepareBill(client, shirtSpec())).rejects.toThrow(/Insufficient stock: BC25385 Pink\/XL\|42 has 0, needs 1/);
    const p = await prepareBill(client, shirtSpec({ stock_adds: [addXL] }));
    expect(p.stock_adds).toEqual([
      { productid: "BC25385", name: "Cotton Self-Shirt", size: "XL|42", color: "Pink", variantid: "v-xl", created: false, qty: 1, stock_before: 0, stock: 1 },
    ]);
    expect(p.stock).toEqual([
      { variantid: "v-xl", productid: "BC25385", size: "XL|42", color: "Pink", stock_before: 1, change: -1, stock_after: 0 },
    ]);
    expect(client.calls.every((c) => c.op === "select")).toBe(true);
  });

  it("preview bills a variant a stock add will create, under a placeholder id", async () => {
    const { client } = shelf();
    const p = await prepareBill(client, shirtSpec({ stock_adds: [add3XL], items: shirt3XL }));
    expect(p.stock_adds[0]).toMatchObject({ variantid: "new:BC25385:Pink/3XL|46", created: true, stock_before: 0, stock: 1 });
    expect(p.bill_items[0]).toMatchObject({ variantid: "new:BC25385:Pink/3XL|46", product_code: "BC25385", total: 1495 });
    expect(client.calls.every((c) => c.op === "select")).toBe(true);
    // Never sent to the database as a variant id.
    expect(client.calls.some((c) => (filterOf(c, "in", "variantid") ?? []).some((id) => id.startsWith("new:")))).toBe(false);
  });

  it("refuses a stock add as stock add does, against its entry", async () => {
    const { client } = shelf();
    const { new_variant, ...noFlag } = add3XL;
    await expect(prepareBill(client, shirtSpec({ stock_adds: [noFlag], items: shirt3XL }))).rejects.toThrow(
      /^stock_adds\[0\]: BC25385 has no Pink \/ 3XL\|46 variant/,
    );
  });

  it("counts earlier adds to the same variant", async () => {
    const { client } = shelf();
    const p = await prepareBill(client, shirtSpec({ stock_adds: [add3XL, { ...add3XL, qty: 2 }], items: shirt3XL }));
    expect(p.stock_adds.map((a) => [a.created, a.stock_before, a.stock])).toEqual([[true, 0, 1], [false, 1, 3]]);
    expect(p.stock[0]).toMatchObject({ stock_before: 3, stock_after: 2 });
  });

  it("create sends the stock adds and the bill in one call, then logs both", async () => {
    const { client, variants } = shelf();
    const out = await createBill(client, shirtSpec({ stock_adds: [addXL] }));
    expect(writesOf(client)).toEqual(["bill_save_with_stock_adds", "activity_log.insert", "activity_log.insert"]);
    const { args } = client.calls.find((c) => c.fn === "bill_save_with_stock_adds");
    expect(args.p_stock_adds).toEqual([{ variantid: "v-xl", productid: "BC25385", size: "XL|42", color: "Pink", qty: 1, create: false }]);
    expect(args.p_op).toBe("finalize_create");
    expect(args.p_payload.items[0].variantid).toBe("v-xl");
    expect(client.calls.filter((c) => c.table === "activity_log").map((c) => c.row.summary)[0]).toBe(
      "Increased stock of Pink / XL|42, product BC25385 — Cotton Self-Shirt: 0 → 1 (+1) (via CLI)",
    );
    expect(out.stock_adds).toEqual([expect.objectContaining({ variantid: "v-xl", created: false, stock_before: 0, stock: 1, qty: 1 })]);
    expect(out.bill_number).toBe("FY26-000339");
    expect(variants[0].stock).toBe(1);
  });

  it("create names a new variant by a real id, in the add and in the bill line", async () => {
    const { client, variants } = shelf();
    const out = await createBill(client, shirtSpec({ stock_adds: [add3XL], items: shirt3XL }));
    const { args } = client.calls.find((c) => c.fn === "bill_save_with_stock_adds");
    const id = args.p_stock_adds[0].variantid;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(args.p_stock_adds[0]).toMatchObject({ productid: "BC25385", size: "3XL|46", color: "Pink", qty: 1, create: true });
    expect(args.p_payload.items[0].variantid).toBe(id);
    expect(variants[1]).toMatchObject({ variantid: id, stock: 1 });
    expect(out.stock_adds[0]).toMatchObject({ variantid: id, created: true });
    expect(client.calls.find((c) => c.table === "activity_log").row.summary).toBe(
      "Added variant Pink / 3XL|46 to product BC25385 — Cotton Self-Shirt (stock 1) (via CLI)",
    );
  });

  it("two adds to the same new variant share its id: the first creates it, the second adds to it", async () => {
    const { client } = shelf();
    await createBill(client, shirtSpec({ stock_adds: [add3XL, { ...add3XL, qty: 2 }], items: shirt3XL }));
    const adds = client.calls.find((c) => c.fn === "bill_save_with_stock_adds").args.p_stock_adds;
    expect(adds.map((a) => [a.create, a.qty])).toEqual([[true, 1], [false, 2]]);
    expect(adds[1].variantid).toBe(adds[0].variantid);
  });

  it("a part-paid bill with stock adds goes through the same one call", async () => {
    const { client } = shelf();
    await createBill(client, shirtSpec({ stock_adds: [addXL], payment: { method: "Cash", amount: 500, balance_due: 995 } }));
    expect(client.calls.find((c) => c.fn === "bill_save_with_stock_adds").args.p_op).toBe("partial_create");
  });

  it("a bill without stock adds still uses bill_save", async () => {
    const { client, variants } = shelf();
    variants[0].stock = 1;
    await createBill(client, shirtSpec());
    expect(writesOf(client)).toEqual(["bill_save", "activity_log.insert"]);
  });

  it("a failed save leaves no stock added and nothing to undo", async () => {
    const { client, variants } = shelf({ atomicSave: failingSave });
    await expect(createBill(client, shirtSpec({ stock_adds: [add3XL], items: shirt3XL }))).rejects.toThrow(/^Failed to save bill: db down$/);
    expect(writesOf(client)).toEqual(["bill_save_with_stock_adds"]);
    expect(variants.map((v) => v.variantid)).toEqual(["v-xl"]);
  });

  // A draft has no bill_save op: its adds are separate writes, undone if the draft fails.
  const draftSpec = (o) => shirtSpec({ draft: true, ...o });
  const failingDraft = { data: null, error: { message: "db down" } };

  it("a draft adds the stock with stock add's writes, then saves the draft", async () => {
    const { client, variants } = shelf();
    await createBill(client, draftSpec({ stock_adds: [addXL] }));
    expect(writesOf(client)).toEqual([
      "stock_adjust", "activity_log.insert", "bills.insert", "bill_items.insert", "stock_adjust", "activity_log.insert",
    ]);
    expect(client.calls.find((c) => c.fn === "stock_adjust").args).toEqual({ p_variant: "v-xl", p_delta: 1, p_reason: "manual_edit", p_ref: "BC25385" });
    // Added for the slip, then taken by the draft.
    expect(variants[0].stock).toBe(0);
  });

  it("takes the stock back when the draft then fails, and says so", async () => {
    const { client, variants } = shelf({ draftInsert: failingDraft });
    await expect(createBill(client, draftSpec({ stock_adds: [addXL] }))).rejects.toThrow(
      "Failed to save bill: db down — stock adds undone: BC25385 Pink / XL|42 +1 stock taken back",
    );
    expect(writesOf(client)).toEqual(["stock_adjust", "activity_log.insert", "bills.insert", "stock_adjust", "activity_log.insert"]);
    expect(client.calls.filter((c) => c.fn === "stock_adjust").map((c) => c.args.p_delta)).toEqual([1, -1]);
    expect(client.calls.at(-1).row.summary).toBe(
      "Decreased stock of Pink / XL|42, product BC25385 — Cotton Self-Shirt: 1 → 0 (-1), added for a bill that failed (via CLI)",
    );
    expect(variants[0].stock).toBe(0);
  });

  it("deletes a variant it created when the draft then fails", async () => {
    const { client, variants } = shelf({ draftInsert: failingDraft });
    await expect(createBill(client, draftSpec({ stock_adds: [add3XL], items: shirt3XL }))).rejects.toThrow(
      "Failed to save bill: db down — stock adds undone: BC25385 Pink / 3XL|46 +1 variant removed",
    );
    expect(writesOf(client).slice(-2)).toEqual(["productsizecolors.delete", "activity_log.insert"]);
    expect(variants.map((v) => v.variantid)).toEqual(["v-xl"]);
  });

  it("keeps a created variant the database will not delete, and takes its stock back", async () => {
    const { client, variants } = shelf({ draftInsert: failingDraft, deleteError: { message: "violates foreign key constraint" } });
    await expect(createBill(client, draftSpec({ stock_adds: [add3XL], items: shirt3XL }))).rejects.toThrow(
      /stock adds undone: BC25385 Pink \/ 3XL\|46 \+1 stock taken back, variant kept \(violates foreign key constraint\)/,
    );
    expect(variants[1]).toMatchObject({ size: "3XL|46", stock: 0 });
  });

  it("names an add it could not undo", async () => {
    const { client } = shelf({ draftInsert: failingDraft, undoError: { message: "permission denied" } });
    await expect(createBill(client, draftSpec({ stock_adds: [addXL] }))).rejects.toThrow(
      "Failed to save bill: db down — stock adds NOT all undone, fix them in the inventory editor: " +
        "BC25385 Pink / XL|42 +1 (could not take the stock back: permission denied)",
    );
  });

  it("dry run writes nothing", async () => {
    const { client } = shelf();
    const out = await createBill(client, shirtSpec({ stock_adds: [add3XL], items: shirt3XL }), { dryRun: true });
    expect(out.stock_adds[0]).toMatchObject({ created: true });
    expect(client.calls.every((c) => c.op === "select")).toBe(true);
  });
});

describe("sold_total (one amount for several lines)", () => {
  describe("splitByMrpShare", () => {
    it.each([
      // Owner's example (2026-11-11): 792.22 / 1057.78 → 790 / 1060.
      [1850, [1000, 1335], [790, 1060]],
      // Slip 441: 1580 over MRP 1195 + 799.
      [1580, [1195, 799], [950, 630]],
      // A total off the ₹10 grid lands its odd rupees on the largest line.
      [1855, [1000, 1335], [790, 1065]],
      // Three lines; the largest line takes the remainder.
      [4000, [2995, 1795, 895], [2110, 1260, 630]],
      // Single line: the whole total.
      [1234.5, [2000], [1234.5]],
      // At or above the MRP total every line stays at MRP.
      [3000, [1000, 2000], [1000, 2000]],
    ])("splits %p over %p → %p", (total, grosses, want) => {
      const out = splitByMrpShare(total, grosses);
      expect(out).toEqual(want);
      expect(out.reduce((s, a) => s + a, 0)).toBeCloseTo(Math.min(total, grosses.reduce((s, g) => s + g, 0)), 2);
    });

    it("keeps paisa shares when rounding would push the largest line over its MRP", () => {
      // 14 + 1000 sold for 1013: the small line rounds down to 10, leaving 1003 on a ₹1000 line.
      expect(splitByMrpShare(1013, [14, 1000])).toEqual([13.99, 999.01]);
    });
  });

  it.each([
    [{ ...slip387, sold_total: 0, items: [{ variantid: VID, qty: 1 }] }, /sold_total must be > 0/],
    [{ ...slip387, sold_total: "x", items: [{ variantid: VID, qty: 1 }] }, /sold_total/],
    [{ ...slip387, sold_total: 1800 }, /sold_total or line amounts, not both/],
  ])("refuses a bad sold_total %#", (spec, msg) => {
    expect(() => parseBillSpec(spec)).toThrow(msg);
  });

  it("prices each line at its MRP share and shows the split in the preview", async () => {
    const VID2 = "11111111-2222-3333-4444-555555555555";
    const client = fakeSupabase(db({
      "productsizecolors.select": {
        data: [
          { variantid: VID, productid: "BC252051", size: "FREE-SIZE", color: "Mustard", stock: 1 },
          { variantid: VID2, productid: "BC25132", size: "L|40", color: "White Grey", stock: 1 },
        ],
        error: null,
      },
      "products.select": {
        data: [
          { productid: "BC252051", name: "Georgette-Saree", categoryid: "SA", retailprice: 2395, unit_type: "piece" },
          { productid: "BC25132", name: "Cotton Shirt", categoryid: "SH", retailprice: 799, unit_type: "piece" },
        ],
        error: null,
      },
    }));
    const spec = {
      ...slip387,
      payment: { method: "Cash", amount: 2500 },
      sold_total: 2500,
      items: [{ variantid: VID, qty: 1 }, { variantid: VID2, qty: 1 }],
    };
    const p = await prepareBill(client, spec);
    // 2500 × 2395/3194 = 1874.6 → 1870 (largest line takes the rest: 1870); 2500 × 799/3194 = 625.4 → 630.
    expect(p.sold_split).toEqual([1870, 630]);
    expect(p.totals.grand_total).toBe(2500);
    expect(p.bill_items.map((l) => Math.round(l.total))).toEqual([1870, 630]);
  });

  it("slip finish checks each line against its share", () => {
    const spec = {
      customerid: 453,
      date: "2026-10-22",
      payment: { method: "Cash", amount: 1850 },
      sold_total: 1850,
      items: [{ variantid: "a", qty: 1 }, { variantid: "b", qty: 1 }],
    };
    const bill = (t1, t2) => ({
      billid: 1, bill_number: "FY26-1", customerid: 453, orderdate: "2026-10-21T18:30:00+00:00",
      paymentstatus: "finalized", totalamount: 1850, payment_amount: 1850, payment_method: "Cash",
      customer: { customerid: 453, first_name: "Test", last_name: "Customer", phone: "+919000000001" }, salespersons: [],
      items: [
        { product_code: "BC1", variantid: "a", quantity: 1, mrp: 1000, total: t1, alteration_charge: 0 },
        { product_code: "BC2", variantid: "b", quantity: 1, mrp: 1335, total: t2, alteration_charge: 0 },
      ],
    });
    expect(checkBillAgainstSpec(spec, bill(790, 1060)).ok).toBe(true);
    expect(checkBillAgainstSpec(spec, bill(1060, 790)).mismatches).toEqual([
      "items[0] amount: spec 790, bill 1060",
      "items[1] amount: spec 1060, bill 790",
    ]);
  });
});
