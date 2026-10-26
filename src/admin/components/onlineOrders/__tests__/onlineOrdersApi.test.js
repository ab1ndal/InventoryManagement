import { action, getOrder, listOrders, OrderActionError } from "../onlineOrdersApi";

// Plain functions: CRA resetMocks wipes jest.fn implementations between tests.
let mockCalls = [];
let mockResults = {};
let mockInvoke = null;

const mockChain = (table) => {
  const call = { table, ops: [] };
  mockCalls.push(call);
  const chain = {};
  for (const m of ["select", "eq", "in", "or", "order", "limit", "single"]) {
    chain[m] = (...args) => {
      call.ops.push([m, ...args]);
      return chain;
    };
  }
  chain.then = (resolve) => resolve(mockResults[table] || { data: [], error: null });
  return chain;
};

jest.mock("../../../../lib/supabaseClient", () => ({
  supabase: {
    from: (t) => mockChain(t),
    functions: { invoke: (...args) => mockInvoke(...args) },
  },
}));


beforeEach(() => {
  mockCalls = [];
  mockResults = {};
  mockInvoke = null;
});

const opsOf = (table) => mockCalls.find((c) => c.table === table).ops;

test("to_check tab lists paid orders only", async () => {
  await listOrders("to_check");
  expect(opsOf("orders")).toContainEqual(["in", "status", ["paid"]]);
});

test("shipped tab includes out_for_delivery", async () => {
  await listOrders("shipped");
  expect(opsOf("orders")).toContainEqual(["in", "status", ["shipped", "out_for_delivery"]]);
});

test("problems tab ORs problem, process_error, rto and orders with failed jobs", async () => {
  mockResults.order_jobs = { data: [{ order_id: "o1" }, { order_id: "o1" }, { order_id: "o2" }], error: null };
  await listOrders("problems");
  expect(opsOf("order_jobs")).toContainEqual(["eq", "status", "failed"]);
  expect(opsOf("orders")).toContainEqual([
    "or",
    "problem.not.is.null,process_error.not.is.null,status.eq.rto,id.in.(o1,o2)",
  ]);
});

test("all tab applies no status filter", async () => {
  await listOrders("all");
  const ops = opsOf("orders").map((o) => o[0]);
  expect(ops).not.toContain("in");
  expect(ops).not.toContain("or");
});

test("action posts the payload to admin-order-action", async () => {
  mockInvoke = async (name, opts) => ({ data: { ok: true, name, body: opts.body }, error: null });
  const res = await action({ action: "process", orderId: "o1", opKey: "k1" });
  expect(res).toEqual({ ok: true, name: "admin-order-action", body: { action: "process", orderId: "o1", opKey: "k1" } });
});

test("action turns a non-2xx response into OrderActionError with status and code", async () => {
  mockInvoke = async () => ({
    data: null,
    error: {
      message: "Edge Function returned a non-2xx status code",
      context: { status: 409, json: async () => ({ error: "order busy", code: "busy" }) },
    },
  });
  await expect(action({ action: "process", orderId: "o1", opKey: "k" })).rejects.toMatchObject({
    name: "OrderActionError",
    status: 409,
    code: "busy",
    message: "order busy",
  });
  expect(OrderActionError).toBeDefined();
});

test("getOrder exposes the order's returns (items, photo ids only) on order.returns", async () => {
  mockResults.orders = { data: { id: "o1", status: "delivered" }, error: null };
  mockResults.order_returns = { data: [{ id: "r1", items: [], photos: [{ id: "p1", uploaded_at: "t" }] }], error: null };
  const d = await getOrder("o1");
  expect(d.order.returns).toEqual([{ id: "r1", items: [], photos: [{ id: "p1", uploaded_at: "t" }] }]);
  expect(d.order.status).toBe("delivered");
  const ops = opsOf("order_returns");
  expect(ops).toContainEqual(["eq", "order_id", "o1"]);
  const sel = ops.find((o) => o[0] === "select")[1];
  expect(sel).toContain("order_return_photos(id, uploaded_at)");
  expect(sel).not.toContain("path");
});

test("getOrder sorts embedded return items and photos in JS and never orders by embedded table", async () => {
  mockResults.orders = { data: { id: "o1" }, error: null };
  mockResults.order_returns = {
    data: [{
      id: "r1",
      items: [{ item_id: "b" }, { item_id: "a" }],
      // same instant at different precision/offset: a string compare would put p2 first
      photos: [
        { id: "p2", uploaded_at: "2026-10-26T10:00:00.5+00:00" },
        { id: "p3", uploaded_at: "2026-10-26T10:00:00.12+00:00" },
        { id: "p1", uploaded_at: "2026-10-26T15:29:59+05:30" },
      ],
    }],
    error: null,
  };
  const d = await getOrder("o1");
  expect(d.order.returns[0].items.map((i) => i.item_id)).toEqual(["a", "b"]);
  expect(d.order.returns[0].photos.map((p) => p.id)).toEqual(["p1", "p3", "p2"]);
  expect(opsOf("order_returns").some((o) => o[0] === "order" && o[2]?.referencedTable)).toBe(false);
});
