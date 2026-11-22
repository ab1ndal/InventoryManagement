import { prepareBill, createBill, checkBillAgainstSpec, parseBillSpec } from "../bills";
import { parseExchange, ExchangeInputError } from "../exchanges";
import { fakeSupabase } from "../testing/fakeSupabase";

// jsdom (CRA's jest env) has no crypto.randomUUID, which createBill uses for p_key.
if (!global.crypto?.randomUUID) {
  Object.defineProperty(global, "crypto", { value: require("crypto").webcrypto, configurable: true });
}

// Made-up data. A customer returns a kurti bought on FY26-000123 for 1500 and buys a saree
// (MRP 2395) for 1800, paying the 300 difference in cash.
const VID = "29c3daa8-5483-4c84-8959-1c930b8d1bb4";
const SRC_VID = "7a1e0c55-0000-4000-8000-000000000001";

const exchangeSlip = {
  customerid: 453,
  date: "2026-11-14",
  payment: { method: "Cash", amount: 300 },
  exchange: { bill: "FY26-000123", items: [{ product: "BC-26001", size: "m|38", color: "black", qty: 1, reason: "size" }] },
  items: [{ variantid: VID, qty: 1, amount: 1800 }],
};

const sourceBill = {
  billid: 700,
  bill_number: "FY26-000123",
  customerid: 453,
  orderdate: "2026-11-10T00:00:00",
  paymentstatus: "finalized",
  payment_amount: 1500,
  store_credit_used: 0,
  stock_reduced: true,
};
const sourceLine = {
  bill_item_id: 5001,
  product_name: "Cotton-Kurti",
  product_code: "BC26001",
  quantity: 1,
  total: 1500,
  alteration_charge: 0,
  variantid: SRC_VID,
};
const variantRows = [
  { variantid: VID, productid: "BC252051", size: "FREE-SIZE", color: "Mustard", stock: 1 },
  { variantid: SRC_VID, productid: "BC26001", size: "M|38", color: "Black", stock: 0 },
];
// Rows whose variantid is in the query's `in` filter, as the database would return them.
const byIn = (rows, col) => (call) => {
  const f = call.filters.find(([kind, c]) => kind === "in" && c === col);
  return { data: f ? rows.filter((r) => f[2].includes(r[col])) : rows, error: null };
};

const db = (overrides = {}) => ({
  "customers.select": { data: { customerid: 453, first_name: "Test", last_name: "Customer", phone: "+919000000001" }, error: null },
  "salesmethods.select": { data: [{ salesmethodid: 1, methodname: "Cash" }, { salesmethodid: 4, methodname: "Mixed" }], error: null },
  "saleslocations.select": { data: [{ saleslocationid: 1, locationname: "Walk-In" }], error: null },
  "productsizecolors.select": byIn(variantRows, "variantid"),
  "products.select": {
    data: [{ productid: "BC252051", name: "Georgette-Saree", categoryid: "SA", retailprice: 2395, unit_type: "piece" }],
    error: null,
  },
  "bills.select": { data: sourceBill, error: null },
  "bill_items.select": { data: [sourceLine], error: null },
  "orders.select": { data: null, error: null },
  "bill_payments.select": { data: [], error: null },
  "exchanges.select": { data: [], error: null },
  ...overrides,
});

describe("parseExchange", () => {
  it.each([
    ["x", /exchange must be an object/],
    [{ bill: "FY26-000123" }, /at least one returned item/],
    [{ bill: "FY26-000123", items: [{ product: "BC1", qty: 1 }], exchange_ids: [1] }, /not both/],
    [{ items: [{ product: "BC1", qty: 1 }] }, /exchange.bill is required/],
    [{ bill: "FY26-000123", items: [{ product: "BC1", qty: "1" }] }, /qty must be a number > 0/],
    [{ bill: "FY26-000123", items: [{ product: "BC1", qty: 0 }] }, /qty must be a number > 0/],
    [{ bill: "FY26-000123", items: [{ product: "BC1", bill_item_id: 3, qty: 1 }] }, /exactly one of product or bill_item_id/],
    [{ bill: "FY26-000123", items: [{ bill_item_id: 3, size: "M", qty: 1 }] }, /color\/size only go with product/],
    [{ bill: "FY26-000123", items: [{ product: "BC1", qty: 1, colour: "Red" }] }, /unknown field\(s\) colour/],
    [{ exchange_ids: [] }, /list of exchange ids/],
    [{ exchange_ids: [4, 4] }, /listed twice/],
    [{ exchange_ids: [4], balance: "cash" }, /store_credit or cash_refund/],
  ])("rejects a malformed exchange %#", (ex, msg) => {
    expect(() => parseExchange(ex)).toThrow(ExchangeInputError);
    expect(() => parseExchange(ex)).toThrow(msg);
  });

  it("refuses an exchange on a draft, and lets payment be left out", () => {
    expect(() => parseBillSpec({ ...exchangeSlip, draft: true })).toThrow(/not supported on a draft/);
    const { payment, ...noPayment } = exchangeSlip;
    expect(parseBillSpec(noPayment).payment).toEqual({ method: "", amount: 0, balance_due: 0 });
  });
});

describe("prepareBill with an exchange", () => {
  it("takes the credit off what is paid, as the bill screen does, and plans exchange_record", async () => {
    const p = await prepareBill(fakeSupabase(db()), exchangeSlip);
    expect(p.totals).toEqual({
      mrp_total: 2395, line_discounts: 594.92, balance_discount: 0.08, grand_total: 1800,
      exchange_credit: 1500, net_due: 300, paid: 300,
    });
    expect(p.bill).toMatchObject({
      totalamount: 1800,
      payment_amount: 300,
      exchange_credit_used: 1500,
      exchange_source_bill: "FY26-000123",
      exchange_cash_refund: 0,
    });
    expect(p.exchange).toEqual({
      kind: "return",
      source_bill: "FY26-000123",
      returned: [{
        bill_item_id: 5001, code: "BC26001", name: "Cotton-Kurti", size: "M|38", color: "Black", qty: 1, credit: 1500,
        stock: { variantid: SRC_VID, stock_before: 0, stock_after: 1 },
      }],
      exchange_ids: null,
      credit: 1500,
      credit_used: 1500,
      balance: 0,
      balance_to: null,
      record: {
        p_billid: 700,
        p_customerid: 453,
        p_returndate: "2026-11-14T12:00:00",
        p_items: [{
          bill_item_id: 5001, quantity: 1, credit_amount: 1500, reason: "size",
          product_name: "Cotton-Kurti", product_code: "BC26001", variantid: SRC_VID,
        }],
      },
      outside_window: null,
    });
    expect(p.warnings).toEqual([]);
  });

  it("is read-only", async () => {
    const client = fakeSupabase(db());
    await prepareBill(client, exchangeSlip);
    expect(client.calls.every((c) => c.op === "select")).toBe(true);
  });

  it("returns part of a multi-unit line at its share of the line total", async () => {
    const p = await prepareBill(
      fakeSupabase(db({ "bill_items.select": { data: [{ ...sourceLine, quantity: 3, total: 200 }], error: null }, "bills.select": { data: { ...sourceBill, payment_amount: 200 }, error: null } })),
      { ...exchangeSlip, payment: { method: "Cash", amount: 1733.33 } },
    );
    expect(p.exchange.credit).toBe(66.67);
  });

  it("caps the last unit so a line never gives more than its total", async () => {
    // 200 over 3 units: two returned earlier for 133.34 in all; the last gets 66.66, not 66.67.
    const p = await prepareBill(
      fakeSupabase(db({
        "bill_items.select": { data: [{ ...sourceLine, quantity: 3, total: 200 }], error: null },
        "bills.select": { data: { ...sourceBill, payment_amount: 200 }, error: null },
        "exchanges.select": { data: [{ exchangeid: 8, original_bill_item_id: 5001, quantity: 2, credit_amount: 133.34, new_billid: 950, new_bill: { bill_number: "FY26-000130" } }], error: null },
      })),
      { ...exchangeSlip, payment: { method: "Cash", amount: 1733.34 } },
    );
    expect(p.exchange.credit).toBe(66.66);
  });

  it("counts returned pieces as back on the shelf for a new line of the same variant", async () => {
    const withProduct = db({
      "products.select": { data: [{ productid: "BC26001", name: "Cotton-Kurti", categoryid: "KU", retailprice: 1500, unit_type: "piece" }], error: null },
    });
    const q = await prepareBill(fakeSupabase(withProduct), {
      ...exchangeSlip,
      payment: undefined,
      items: [{ variantid: SRC_VID, qty: 1, amount: 1500 }],
    });
    expect(q.stock).toEqual([
      { variantid: SRC_VID, productid: "BC26001", size: "M|38", color: "Black", stock_before: 1, change: -1, stock_after: 0 },
    ]);
    expect(q.totals).toMatchObject({ grand_total: 1500, exchange_credit: 1500, net_due: 0, paid: 0 });
    expect(q.bill).toMatchObject({ payment_amount: 0, salesmethodid: null, exchange_credit_used: 1500 });
  });

  it.each([
    ["the bill is not paid in full", { "bills.select": { data: { ...sourceBill, paymentstatus: "partial" }, error: null } }, /FY26-000123 is partial: Only a fully paid bill can be exchanged/],
    ["the bill does not exist", { "bills.select": { data: null, error: null } }, /no bill numbered FY26-000123/],
    ["the bill is another customer's", { "bills.select": { data: { ...sourceBill, customerid: 99 }, error: null } }, /belongs to customer 99/],
    ["the online order is not delivered", { "orders.select": { data: { delivered_at: null }, error: null } }, /not been delivered yet/],
    ["the line had an alteration", { "bill_items.select": { data: [{ ...sourceLine, alteration_charge: 200 }], error: null } }, /alteration charge, so it cannot be exchanged/],
    [
      "the bill already gave back what it holds",
      { "bills.select": { data: { ...sourceBill, payment_amount: 1000 }, error: null } },
      /already given back what the customer paid for it.*holds ₹1,000, credit already given ₹0, this exchange ₹1,500/,
    ],
  ])("refuses when %s", async (_, overrides, msg) => {
    await expect(prepareBill(fakeSupabase(db(overrides)), exchangeSlip)).rejects.toThrow(msg);
  });

  it("refuses a line not on the bill, listing its lines", async () => {
    const spec = { ...exchangeSlip, exchange: { bill: "FY26-000123", items: [{ product: "BC26001", color: "Red", qty: 1 }] } };
    await expect(prepareBill(fakeSupabase(db()), spec)).rejects.toThrow(
      "exchange.items[0]: not on bill FY26-000123 (its lines: BC26001 Black / M|38 (bill_item_id 5001))",
    );
  });

  it("refuses a product on two lines unless size/colour or bill_item_id picks one", async () => {
    const two = db({ "bill_items.select": { data: [sourceLine, { ...sourceLine, bill_item_id: 5002, variantid: VID }], error: null } });
    const spec = { ...exchangeSlip, exchange: { bill: "FY26-000123", items: [{ product: "BC26001", qty: 1 }] } };
    await expect(prepareBill(fakeSupabase(two), spec)).rejects.toThrow(/matches 2 lines of FY26-000123/);
    const byLine = { ...spec, exchange: { bill: "FY26-000123", items: [{ bill_item_id: 5001, qty: 1 }] } };
    expect((await prepareBill(fakeSupabase(two), byLine)).exchange.returned[0].bill_item_id).toBe(5001);
  });

  it("refuses what was already returned, pointing at unspent credit so it is never given twice", async () => {
    const earlier = db({
      "exchanges.select": { data: [{ exchangeid: 17, original_bill_item_id: 5001, quantity: 1, credit_amount: 1500, new_billid: null, new_bill: null }], error: null },
    });
    await expect(prepareBill(fakeSupabase(earlier), exchangeSlip)).rejects.toThrow(
      "exchange.items[0]: BC26001 Black / M|38 (bill_item_id 5001) was bought 1, 1 already returned, so at most 0 can be returned now " +
        '(exchange 17: 1 returned, credit ₹1,500, not spent yet). If this slip spends that credit, use "exchange": {"exchange_ids": [17]}',
    );
    const spent = db({
      "exchanges.select": { data: [{ exchangeid: 17, original_bill_item_id: 5001, quantity: 1, credit_amount: 1500, new_billid: 960, new_bill: { bill_number: "FY26-000131" } }], error: null },
    });
    await expect(prepareBill(fakeSupabase(spent), exchangeSlip)).rejects.toThrow(/spent on bill FY26-000131\)$/);
  });

  it("checks the payment against what is left after the credit", async () => {
    await expect(prepareBill(fakeSupabase(db()), { ...exchangeSlip, payment: { method: "Cash", amount: 1800 } })).rejects.toThrow(
      "Payment 1800 differs from what is left to pay after the exchange credit (bill total 1800.08 − credit 1500 = 300.08) by 1499.92",
    );
    await expect(prepareBill(fakeSupabase(db()), { ...exchangeSlip, payment: undefined })).rejects.toThrow(
      "payment is required: ₹300.08 is left to pay after the exchange credit of ₹1500",
    );
  });

  it("asks where credit above the bill goes, and records it as the screen does", async () => {
    const cheap = { ...exchangeSlip, payment: undefined, items: [{ variantid: VID, qty: 1, amount: 1200 }] };
    await expect(prepareBill(fakeSupabase(db()), cheap)).rejects.toThrow(
      /credit ₹1500 is ₹299.87 more than the bill total 1200.13: give exchange.balance "store_credit" or "cash_refund"/,
    );
    const cash = await prepareBill(fakeSupabase(db()), { ...cheap, exchange: { ...cheap.exchange, balance: "cash_refund" } });
    expect(cash.bill).toMatchObject({ totalamount: 1200.13, exchange_credit_used: 1200.13, exchange_cash_refund: 299.87, payment_amount: 0 });
    expect(cash.exchange).toMatchObject({ balance: 299.87, balance_to: "cash_refund" });
    const credit = await prepareBill(fakeSupabase(db()), { ...cheap, exchange: { ...cheap.exchange, balance: "store_credit" } });
    expect(credit.bill.exchange_cash_refund).toBe(0);
    expect(credit.exchange).toMatchObject({ balance: 299.87, balance_to: "store_credit" });
    await expect(
      prepareBill(fakeSupabase(db()), { ...exchangeSlip, exchange: { ...exchangeSlip.exchange, balance: "cash_refund" } }),
    ).rejects.toThrow(/exchange.balance is only for credit left over/);
  });

  it("prices a part-paid bill at what is left after the credit, as the screen's partial finalize", async () => {
    const p = await prepareBill(fakeSupabase(db()), { ...exchangeSlip, payment: { method: "Cash", amount: 100, balance_due: 200 } });
    expect(p.status).toBe("partial");
    expect(p.bill).toMatchObject({ totalamount: 1800, net_amount: 300, final_amount: 300, payment_amount: 100, exchange_credit_used: 1500 });
    expect(p.totals).toMatchObject({ exchange_credit: 1500, net_due: 300, paid: 100, balance_due: 200 });
  });

  it("warns outside the 7-day window and for a bill saved without taking stock", async () => {
    const p = await prepareBill(
      fakeSupabase(db({ "bills.select": { data: { ...sourceBill, orderdate: "2026-11-01T00:00:00", stock_reduced: false }, error: null } })),
      exchangeSlip,
    );
    expect(p.exchange.outside_window).toBe("Bill #FY26-000123 is 13 days old on 2026-11-14");
    expect(p.warnings).toEqual([
      expect.stringMatching(/13 days old on 2026-11-14, outside the 7-day exchange window/),
      expect.stringMatching(/saved with "don't reduce stock", but the return still puts the pieces back/),
    ]);
  });

  it("puts a returned manual item back in stock; exchange_record finds it from the line", async () => {
    const manualLine = { ...sourceLine, variantid: null, product_code: "BCX26001", product_name: "Suit" };
    const p = await prepareBill(
      fakeSupabase(db({
        "bill_items.select": { data: [manualLine], error: null },
        "manual_items.select": { data: [{ manual_item_id: "BCX26001", size: "38", color: "Black", stock: 0 }], error: null },
      })),
      { ...exchangeSlip, exchange: { bill: "FY26-000123", items: [{ product: "BCX26001", qty: 1 }] } },
    );
    expect(p.exchange.returned[0]).toMatchObject({
      code: "BCX26001", size: "38", color: "Black",
      stock: { manual_item_id: "BCX26001", stock_before: 0, stock_after: 1 },
    });
    expect(p.exchange.record.p_items[0]).toMatchObject({ variantid: null, product_code: "BCX26001" });
    expect(p.exchange.record.p_items[0]).not.toHaveProperty("manual_item_id");
    expect(p.warnings).toEqual([]);
  });

  // Fabric by the metre goes back whole (schema/migration_exchange_fractional_qty.sql).
  const fabricLine = { ...sourceLine, variantid: null, product_code: "BCX26002", product_name: "Fabric", quantity: 3.5, unit_type: "meter" };
  const fabricDb = (overrides = {}, line = fabricLine) =>
    fakeSupabase(db({
      "bill_items.select": { data: [line], error: null },
      "manual_items.select": { data: [{ manual_item_id: "BCX26002", size: null, color: "Blue", stock: 0 }], error: null },
      ...overrides,
    }));
  const fabricSlip = (qty) => ({ ...exchangeSlip, exchange: { bill: "FY26-000123", items: [{ product: "BCX26002", qty }] } });

  it("returns a 3.5 m fabric line whole, for the line's total", async () => {
    const p = await prepareBill(fabricDb(), fabricSlip(3.5));
    expect(p.exchange.returned[0]).toMatchObject({
      qty: 3.5, credit: 1500, stock: { manual_item_id: "BCX26002", stock_before: 0, stock_after: 3.5 },
    });
    expect(p.exchange.record.p_items[0]).toMatchObject({ quantity: 3.5, credit_amount: 1500 });
  });

  it.each([1.5, 1, 3])("refuses part of a fabric length (%s of 3.5 m), saying what can be returned", async (qty) => {
    await expect(prepareBill(fabricDb(), fabricSlip(qty))).rejects.toThrow(
      /BCX26002 Blue \(bill_item_id 5001\) is fabric sold by the metre: Fabric goes back whole.*Give qty 3\.5 \(all that is left\)/,
    );
  });

  it("returns a 2 m fabric line only whole", async () => {
    const twoMetres = { ...fabricLine, quantity: 2 };
    await expect(prepareBill(fabricDb({}, twoMetres), fabricSlip(1))).rejects.toThrow(/Give qty 2 \(all that is left\)/);
    const p = await prepareBill(fabricDb({}, twoMetres), fabricSlip(2));
    expect(p.exchange.returned[0]).toMatchObject({ qty: 2, credit: 1500 });
  });

  it("keeps a fractional line that is not sold by the metre to whole numbers", async () => {
    const pieceLine = { ...fabricLine, unit_type: "piece", quantity: 2.5 };
    await expect(prepareBill(fabricDb({}, pieceLine), fabricSlip(2.5))).rejects.toThrow(/qty must be a whole number, got 2\.5/);
  });

  it("returns the rest of a fabric line whole after a metre went back earlier (before the whole-only rule)", async () => {
    const earlier = { exchangeid: 61, original_bill_item_id: 5001, quantity: 1, credit_amount: 428.57, new_billid: 701, new_bill: { bill_number: "FY26-000124" } };
    const p = await prepareBill(fabricDb({ "exchanges.select": { data: [earlier], error: null } }), {
      ...fabricSlip(2.5), payment: { method: "Cash", amount: 728.57 },
    });
    expect(p.exchange.returned[0]).toMatchObject({ qty: 2.5, credit: 1071.43 });
    await expect(prepareBill(fabricDb({ "exchanges.select": { data: [earlier], error: null } }), fabricSlip(1.5)))
      .rejects.toThrow(/Give qty 2\.5/);
  });

  it("keeps piece lines to whole numbers", async () => {
    await expect(prepareBill(fakeSupabase(db()), {
      ...exchangeSlip, exchange: { bill: "FY26-000123", items: [{ product: "BC26001", qty: 0.5 }] },
    })).rejects.toThrow(/BC26001 .*\(bill_item_id 5001\): qty must be a whole number, got 0\.5/);
  });
});

describe("exchange credit recorded earlier (exchange_ids)", () => {
  const recorded = (o = {}) => ({
    exchangeid: 17, customerid: 453, quantity: 1, credit_amount: 1500, new_billid: null, new_bill: null,
    product_name: "Cotton-Kurti", product_code: "BC26001",
    bill_items: { product_name: "Cotton-Kurti", product_code: "BC26001", bills: { bill_number: "FY26-000123" } },
    ...o,
  });
  const spec = { ...exchangeSlip, exchange: { exchange_ids: [17] } };

  it("spends it with no new return", async () => {
    const p = await prepareBill(fakeSupabase(db({ "exchanges.select": { data: [recorded()], error: null } })), spec);
    expect(p.exchange).toMatchObject({ kind: "recorded", source_bill: "FY26-000123", exchange_ids: [17], credit: 1500, record: null });
    expect(p.bill).toMatchObject({ exchange_credit_used: 1500, exchange_source_bill: "FY26-000123", payment_amount: 300 });
  });

  it.each([
    [[], /no exchange 17/],
    [[recorded({ new_billid: 960, new_bill: { bill_number: "FY26-000131" } })], /exchange 17 was already spent on bill FY26-000131/],
    [[recorded({ customerid: 99 })], /exchange 17 is customer 99's credit/],
  ])("refuses unknown, spent or another customer's credit %#", async (rows, msg) => {
    await expect(prepareBill(fakeSupabase(db({ "exchanges.select": { data: rows, error: null } })), spec)).rejects.toThrow(msg);
  });

  it("sends the ids to bill_save and records no exchange", async () => {
    const client = fakeSupabase(db({
      "exchanges.select": { data: [recorded()], error: null },
      "rpc.bill_save": { data: { billid: 901, bill_number: "FY26-000337" }, error: null },
    }));
    await createBill(client, spec);
    expect(client.calls.filter((c) => c.op === "rpc").map((c) => c.fn)).toEqual(["bill_save"]);
    expect(client.calls.find((c) => c.fn === "bill_save").args.p_payload.exchange_ids).toEqual([17]);
  });
});

describe("createBill with an exchange", () => {
  const saved = { billid: 901, bill_number: "FY26-000337", negative_stock: [] };

  it("records the exchange, then spends it in bill_save, as the Exchange page and bill screen do", async () => {
    const client = fakeSupabase(db({
      "rpc.exchange_record": { data: [17], error: null },
      "rpc.bill_save": { data: saved, error: null },
    }));
    const out = await createBill(client, exchangeSlip);
    const writes = client.calls.filter((c) => c.op !== "select").map((c) => c.fn ?? `${c.table}.${c.op}`);
    expect(writes).toEqual(["exchange_record", "activity_log.insert", "bill_save", "activity_log.insert"]);
    expect(client.calls.find((c) => c.fn === "exchange_record").args).toMatchObject({ p_billid: 700, p_customerid: 453 });
    expect(client.calls.filter((c) => c.table === "activity_log")[0].row.summary).toBe(
      "Exchange recorded on bill #FY26-000123 — 1 item, ₹1500.00 credit (via CLI)",
    );
    const { p_payload } = client.calls.find((c) => c.fn === "bill_save").args;
    expect(p_payload.exchange_ids).toEqual([17]);
    expect(p_payload).not.toHaveProperty("exchange_balance_to_credit");
    expect(p_payload.bill).toMatchObject({ exchange_credit_used: 1500, exchange_source_bill: "FY26-000123", payment_amount: 300 });
    expect(out.exchange).toMatchObject({ source_bill: "FY26-000123", exchange_ids: [17], credit: 1500 });
  });

  it("logs that an exchange outside the window was allowed, as the Exchange page does", async () => {
    const client = fakeSupabase(db({
      "bills.select": { data: { ...sourceBill, orderdate: "2026-11-01T00:00:00" }, error: null },
      "rpc.exchange_record": { data: [17], error: null },
      "rpc.bill_save": { data: saved, error: null },
    }));
    await createBill(client, exchangeSlip);
    expect(client.calls.filter((c) => c.table === "activity_log")[0].row.summary).toBe(
      "Allowed exchange outside the 7-day window: Bill #FY26-000123 is 13 days old on 2026-11-14 (via CLI)",
    );
  });

  it("puts credit above the bill on store credit through bill_save", async () => {
    const client = fakeSupabase(db({
      "rpc.exchange_record": { data: [17], error: null },
      "rpc.bill_save": { data: saved, error: null },
    }));
    await createBill(client, {
      ...exchangeSlip,
      payment: undefined,
      exchange: { ...exchangeSlip.exchange, balance: "store_credit" },
      items: [{ variantid: VID, qty: 1, amount: 1200 }],
    });
    expect(client.calls.find((c) => c.fn === "bill_save").args.p_payload).toMatchObject({
      exchange_ids: [17],
      exchange_balance_to_credit: 299.87,
      bill: { exchange_credit_used: 1200.13, exchange_cash_refund: 0, payment_amount: 0, salesmethodid: null },
    });
  });

  it("writes no bill when exchange_record refuses", async () => {
    const client = fakeSupabase(db({ "rpc.exchange_record": { data: null, error: { message: "EXCHANGE_OVER_HELD" } } }));
    await expect(createBill(client, exchangeSlip)).rejects.toThrow(
      "Exchange not recorded, nothing was saved: This bill has already given back what the customer paid for it",
    );
    expect(client.calls.some((c) => c.fn === "bill_save")).toBe(false);
  });

  it("sends the slip date as the return date", async () => {
    const client = fakeSupabase(db({
      "rpc.exchange_record": { data: [17], error: null },
      "rpc.bill_save": { data: saved, error: null },
    }));
    await createBill(client, exchangeSlip);
    expect(client.calls.find((c) => c.fn === "exchange_record").args.p_returndate).toBe("2026-11-14T12:00:00");
  });

  it("says which migration to run when the database has no return date yet, and saves nothing", async () => {
    const client = fakeSupabase(db({
      "rpc.exchange_record": {
        data: null,
        error: { code: "PGRST202", message: "Could not find the function public.exchange_record(p_billid, p_customerid, p_items, p_returndate) in the schema cache" },
      },
    }));
    await expect(createBill(client, exchangeSlip)).rejects.toThrow(
      /nothing was saved: the database's exchange_record does not take a return date yet; the owner must run schema\/migration_exchange_record_return_date.sql first/,
    );
    expect(client.calls.some((c) => c.fn === "bill_save")).toBe(false);
  });

  it("says how to spend the recorded credit when the bill then fails", async () => {
    const client = fakeSupabase(db({
      "rpc.exchange_record": { data: [17], error: null },
      "rpc.bill_save": { data: null, error: { message: "BILL_OVERPAID" } },
    }));
    await expect(createBill(client, exchangeSlip)).rejects.toThrow(
      'Failed to save bill: BILL_OVERPAID — the exchange WAS recorded (exchange ids 17, credit ₹1500, returned stock is back) and its credit is not spent: re-run with "exchange": {"exchange_ids": [17]}',
    );
  });
});

describe("checkBillAgainstSpec with an exchange", () => {
  const saved = (o = {}) => ({
    bill_number: "FY26-000337",
    customerid: 453,
    orderdate: "2026-11-13T18:30:00+00:00",
    paymentstatus: "finalized",
    totalamount: 1800,
    payment_amount: 300,
    payment_method: "Cash",
    exchange_credit_used: 1500,
    exchange_source_bill: "FY26-000123",
    customer: { customerid: 453, first_name: "Test", last_name: "Customer", phone: "+919000000001" },
    salespersons: [],
    items: [{ product_code: "BC252051", variantid: VID, quantity: 1, mrp: 2395, total: 1800, alteration_charge: 0 }],
    ...o,
  });

  it("counts the credit toward the total", () => {
    const r = checkBillAgainstSpec(exchangeSlip, saved());
    expect(r.mismatches).toEqual([]);
    expect(r.saved).toMatchObject({ total: 1800, exchange_credit: 1500, exchange_bill: "FY26-000123", paid: 300 });
  });

  it("flags a bill saved without the exchange, or from another bill", () => {
    expect(checkBillAgainstSpec(exchangeSlip, saved({ exchange_credit_used: 0, exchange_source_bill: null })).mismatches).toEqual(
      expect.arrayContaining(['exchange credit: spec "> 0", bill 0', 'exchange bill: spec "FY26-000123", bill null']),
    );
    const { exchange, ...noExchange } = exchangeSlip;
    expect(checkBillAgainstSpec({ ...noExchange, payment: { method: "Cash", amount: 300 } }, saved()).mismatches).toContain(
      "exchange credit: spec 0, bill 1500",
    );
  });
});
