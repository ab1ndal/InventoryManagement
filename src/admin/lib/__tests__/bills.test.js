import { parseBillSpec, prepareBill, createBill, getBill, findBills, BillInputError } from "../bills";
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

  it("writes the first payment to bill_payments, dated the bill date, before moving stock", async () => {
    const client = fakeSupabase(db({
      "bills.insert": { data: saved, error: null },
      "bill_items.insert": { data: null, error: null },
      "bill_payments.insert": { data: null, error: null },
      "rpc.stock_adjust": { data: 0, error: null },
      "activity_log.insert": { data: null, error: null },
    }));
    const out = await createBill(client, partial);
    const writes = client.calls.filter((c) => c.op !== "select").map((c) => c.fn ?? `${c.table}.${c.op}`);
    expect(writes).toEqual(["bills.insert", "bill_items.insert", "bill_payments.insert", "stock_adjust", "activity_log.insert"]);
    expect(client.calls.find((c) => c.table === "bill_payments").row).toEqual({
      billid: 901, amount: 1000, salesmethodid: 1, recorded_at: "2026-10-22T12:00:00",
    });
    expect(client.calls.find((c) => c.fn === "stock_adjust").args.p_reason).toBe("bill_partial_finalize");
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
      "bills.insert": { data: saved, error: null },
      "bill_items.insert": { data: null, error: null },
      "rpc.stock_adjust": { data: 0, error: null },
      "activity_log.insert": { data: null, error: null },
    }));
    await createBill(client, unpaid);
    expect(client.calls.some((c) => c.table === "bill_payments")).toBe(false);
  });

  it.each([
    [{ ...slip387, payment: { method: "Cash", amount: 0 } }, /payment.amount must be > 0/],
    [{ ...slip387, payment: { amount: 1800 } }, /payment.method is required/],
    [{ ...slip387, payment: { method: "Cash", amount: 0, balance_due: 1800 } }, /no payment.method when nothing is paid/],
  ])("needs a method exactly when something is paid %#", (spec, msg) => {
    expect(() => parseBillSpec(spec)).toThrow(msg);
  });

  it("removes the bill and moves no stock when the payment insert fails", async () => {
    const client = fakeSupabase(db({
      "bills.insert": { data: saved, error: null },
      "bill_items.insert": { data: null, error: null },
      "bill_payments.insert": { data: null, error: new Error("pay boom") },
      "bills.delete": { data: null, error: null },
    }));
    await expect(createBill(client, partial)).rejects.toThrow("Failed to record payment: pay boom (bill 901 removed)");
    expect(client.calls.some((c) => c.fn === "stock_adjust")).toBe(false);
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
  const rdb = (o = {}) =>
    db({
      "customers.select": (call) =>
        call.filters.some((f) => f[1] === "phone") ? { data: [test], error: null } : { data: test, error: null },
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

  it("reports a bad inline manual item against its line", async () => {
    await expect(
      prepareBill(fakeSupabase(rdb()), spec({ items: [{ manual_item: { create: { name: "Fall", category: "ACC", mrp: 150 } }, qty: 1 }] })),
    ).rejects.toThrow(/items\[0\].manual_item.create: A valid cost is required/);
  });

  it("creates the customer and manual item first, then bills them by id", async () => {
    const client = fakeSupabase(
      rdb({
        ...noPhoneMatch,
        "customers.select": (call) =>
          call.filters.some((f) => f[1] === "phone")
            ? { data: [], error: null }
            : { data: { customerid: 500, first_name: "Test", last_name: "Customer", phone: "+919000000001" }, error: null },
        "customers.insert": (call) => ({ data: { customerid: 500, ...call.row }, error: null }),
        "manual_items.select": (call) => ({
          data: [{ manual_item_id: "BCX26129", name: "Fall", categoryid: "ACC", size: null, color: null, purchase_price: 50, mrp: 150 }],
          error: null,
        }),
        "manual_items.insert": (call) => ({ data: { ...call.row, stock: 1 }, error: null }),
        "bills.insert": { data: { billid: 901, bill_number: "FY26-000337" }, error: null },
        "bill_items.insert": { data: null, error: null },
        "rpc.stock_adjust": { data: 0, error: null },
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
    const writes = client.calls.filter((c) => !["select", "rpc"].includes(c.op) || c.fn === "stock_adjust").map((c) => c.fn ?? `${c.table}.${c.op}`);
    expect(writes).toEqual([
      "customers.insert", "activity_log.insert", "manual_items.insert",
      "bills.insert", "bill_items.insert", "stock_adjust", "activity_log.insert",
    ]);
    expect(client.calls.find((c) => c.table === "bills" && c.op === "insert").row.customerid).toBe(500);
    expect(client.calls.find((c) => c.table === "bill_items").row.map((r) => r.product_code)).toEqual(["BC252051", "BCX26129"]);
    expect(out).toMatchObject({ bill_number: "FY26-000337", created: { customer: { customerid: 500 }, manual_items: [{ manual_item_id: "BCX26129" }] } });
  });

  it("says what was already created when the bill then fails", async () => {
    const client = fakeSupabase(
      rdb({
        "customers.select": (call) => (call.filters.some((f) => f[1] === "phone") ? { data: [], error: null } : { data: { customerid: 500, first_name: "W" }, error: null }),
        "customers.insert": (call) => ({ data: { customerid: 500, ...call.row }, error: null }),
        "bills.insert": { data: null, error: new Error("db down") },
      }),
    );
    await expect(createBill(client, spec({ customer: { create: { first: "W" } } }))).rejects.toThrow(
      /Failed to save bill: db down — NOTE: customer 500 were already created; re-run with customer \{ id \}/,
    );
  });
});
