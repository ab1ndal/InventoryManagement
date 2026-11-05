import { createBill } from "../bills";
import { fakeSupabase } from "../testing/fakeSupabase";

// Step 0 of the transactional bill save work: each test pins every write the CLI bill
// path makes today, in order. The snapshots (committed beside this file) are the record
// and include known flaws (for example, a stock failure keeps the bill); do not "fix" a
// snapshot to match a better behaviour. Reads are not recorded.

const VID = "29c3daa8-5483-4c84-8959-1c930b8d1bb4";

const slip = {
  customerid: 453,
  date: "2026-10-22",
  payment: { method: "cash", amount: 1800 },
  items: [{ variantid: VID, qty: 1, amount: 1800 }],
};

const db = (overrides = {}) => ({
  "customers.select": { data: { customerid: 453, first_name: "Test", last_name: "Customer", phone: "+919000000001" }, error: null },
  "salesmethods.select": {
    data: [{ salesmethodid: 1, methodname: "Cash" }, { salesmethodid: 2, methodname: "UPI" }],
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
  "bills.insert": { data: { billid: 900, bill_number: "FY26-000336" }, error: null },
  "bill_items.insert": { data: null, error: null },
  "rpc.stock_adjust": { data: 0, error: null },
  "activity_log.insert": { data: null, error: null },
  "bills.delete": { data: null, error: null },
  ...overrides,
});

const writesOf = (client) =>
  client.calls
    .filter((c) => c.op !== "select")
    .map((c) =>
      c.op === "rpc"
        ? { kind: "rpc", fn: c.fn, args: c.args }
        : { kind: "table", table: c.table, op: c.op, row: c.row, filters: c.filters },
    );

test("pins current behaviour: CLI bill with stock moved", async () => {
  const client = fakeSupabase(db());
  await createBill(client, slip);
  expect(writesOf(client)).toMatchSnapshot();
});

test("pins current behaviour: CLI bill with skip_stock moves no stock", async () => {
  const client = fakeSupabase(db());
  await createBill(client, { ...slip, skip_stock: true });
  expect(writesOf(client)).toMatchSnapshot();
});

test("pins current behaviour: CLI items failure removes the bill row", async () => {
  const client = fakeSupabase(db({ "bill_items.insert": { data: null, error: new Error("items boom") } }));
  await expect(createBill(client, slip)).rejects.toThrow("items boom");
  expect(writesOf(client)).toMatchSnapshot();
});

test("pins current behaviour: CLI stock failure keeps the bill and still logs it", async () => {
  const client = fakeSupabase(db({ "rpc.stock_adjust": { data: null, error: new Error("variant gone") } }));
  await createBill(client, slip);
  expect(writesOf(client)).toMatchSnapshot();
});
