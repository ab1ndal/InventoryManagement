import { action, listOrders, OrderActionError } from "../onlineOrdersApi";

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
