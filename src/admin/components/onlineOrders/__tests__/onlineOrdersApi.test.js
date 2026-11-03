import {
  action,
  countOrders,
  countQueue,
  DEFAULT_QUEUE,
  getOrder,
  listOrders,
  OrderActionError,
  ORDER_QUEUES,
  orderSearchFilter,
  searchOrders,
} from "../onlineOrdersApi";

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

const NOW = new Date("2026-11-02T12:00:00.000Z");
const STALE_CLAUSE =
  'and(courier.in.(porter,self),status.in.(processed,packed,shipped,out_for_delivery),updated_at.lt."2026-10-31T12:00:00.000Z")';
const BASE_CLAUSES = `status.eq.paid,problem.not.is.null,process_error.not.is.null,status.eq.rto,${STALE_CLAUSE}`;

const orOf = (table = "orders") => opsOf(table).find((o) => o[0] === "or")[1];

test("there are three queues and Needs action is the default", () => {
  expect(Object.keys(ORDER_QUEUES)).toEqual(["needs_action", "in_progress", "closed"]);
  expect(DEFAULT_QUEUE).toBe("needs_action");
});

test("unknown queue is refused", async () => {
  await expect(listOrders("to_check")).rejects.toThrow("Unknown order queue: to_check");
});

test("needs action ORs paid, problems, rto and manual orders untouched for two days", async () => {
  await listOrders("needs_action", NOW);
  expect(orOf()).toBe(BASE_CLAUSES);
  expect(opsOf("order_jobs")).toContainEqual(["eq", "status", "failed"]);
  expect(opsOf("order_returns")).toContainEqual(["eq", "status", "open"]);
});

test("needs action adds orders with failed jobs or open returns, each once", async () => {
  mockResults.order_jobs = { data: [{ order_id: "o1" }, { order_id: "o1" }, { order_id: "o2" }], error: null };
  mockResults.order_returns = { data: [{ order_id: "o2" }, { order_id: "o3" }], error: null };
  await listOrders("needs_action", NOW);
  expect(orOf()).toBe(`${BASE_CLAUSES},id.in.(o1,o2,o3)`);
});

test("needs action is a single orders query, so an order matching twice cannot repeat", async () => {
  mockResults.order_returns = { data: [{ order_id: "o1" }], error: null };
  await listOrders("needs_action", NOW);
  expect(mockCalls.filter((c) => c.table === "orders")).toHaveLength(1);
  expect(opsOf("orders").map((o) => o[0])).not.toContain("in");
});

test("a failed returns lookup fails the needs action list", async () => {
  mockResults.order_returns = { data: null, error: { message: "boom" } };
  await expect(listOrders("needs_action", NOW)).rejects.toThrow("Loading open returns: boom");
});

test("in progress lists every open status", async () => {
  await listOrders("in_progress");
  expect(opsOf("orders")).toContainEqual([
    "in",
    "status",
    ["processing", "cancelling", "processed", "packed", "ready_for_pickup", "shipped", "out_for_delivery"],
  ]);
});

test("closed lists delivered, cancelled and rto_received", async () => {
  await listOrders("closed");
  expect(opsOf("orders")).toContainEqual(["in", "status", ["delivered", "cancelled", "rto_received"]]);
});

test("list selects fulfilment, courier and awb (delivery label)", async () => {
  await listOrders("closed");
  const select = opsOf("orders").find((o) => o[0] === "select")[1];
  expect(select).toContain("fulfilment");
  expect(select).toContain(" courier,");
  expect(select).toContain(" awb,");
});

test("counts use a head count with the queue's own filter", async () => {
  mockResults.orders = { count: 4, error: null };
  await expect(countQueue("needs_action", NOW)).resolves.toBe(4);
  expect(opsOf("orders")).toContainEqual(["select", "id", { count: "exact", head: true }]);
  expect(orOf()).toBe(BASE_CLAUSES);
});

test("countOrders counts needs action and in progress", async () => {
  mockResults.orders = { count: 7, error: null };
  await expect(countOrders(NOW)).resolves.toEqual({ needs_action: 7, in_progress: 7 });
});

test("a count failure rejects", async () => {
  mockResults.orders = { count: null, error: { message: "boom" } };
  await expect(countQueue("in_progress", NOW)).rejects.toThrow("Counting In progress orders: boom");
});

// Reads an or() string as PostgREST's grammar does: outside double quotes a comma ends the clause;
// inside them, \ makes the next character literal and nothing else is special.
function parseClauses(filter) {
  const clauses = [];
  let i = 0;
  while (i < filter.length) {
    const open = filter.indexOf('"', i);
    const comma = filter.indexOf(",", i);
    if (open === -1 || (comma !== -1 && comma < open)) {
      throw new Error(`Unquoted value in clause at ${i}: ${filter}`);
    }
    const column = filter.slice(i, open);
    let value = "";
    let at = open + 1;
    while (filter[at] !== '"') {
      if (at >= filter.length) throw new Error(`Unterminated quote: ${filter}`);
      if (filter[at] === "\\") at += 1;
      value += filter[at];
      at += 1;
    }
    clauses.push([column, value]);
    at += 1;
    if (at < filter.length && filter[at] !== ",") throw new Error(`Text after the quote: ${filter}`);
    i = at + 1;
  }
  return clauses;
}

const contains = (literal) => `%${literal}%`;

test.each([
  ["a,status.eq.paid", "a,status.eq.paid"],
  ['x"),id.not.is.null', 'x"),id.not.is.null'],
  ["(a)", "(a)"],
  ["a.b", "a.b"],
  ["back\\slash", "back\\\\slash"],
  ['end\\"', 'end\\\\"'],
  ["half%_off", "half\\%\\_off"],
])("hostile term %s stays one literal value in each clause", (term, like) => {
  const clauses = parseClauses(orderSearchFilter(term));
  const expected = contains(like);
  expect(clauses.map(([c]) => c)).toEqual(["order_ref.ilike.", "contact_name.ilike."]);
  expect(clauses.map(([, v]) => v)).toEqual([expected, expected]);
});

test("a * is not sent as a wildcard: it becomes the one-character match", () => {
  expect(orderSearchFilter("a*b")).toBe('order_ref.ilike."%a_b%",contact_name.ilike."%a_b%"');
});

test("the phone clause uses only the digits of the term", () => {
  const clauses = parseClauses(orderSearchFilter("+91 99999 99999"));
  expect(clauses[2]).toEqual(["contact_phone.ilike.", "%919999999999%"]);
  expect(parseClauses(orderSearchFilter("99999 99999"))[2]).toEqual(["contact_phone.ilike.", "%9999999999%"]);
});

test("a full number typed with a leading 0 still finds the phone", () => {
  expect(parseClauses(orderSearchFilter("09999 999999"))[2]).toEqual(["contact_phone.ilike.", "%9999999999%"]);
});

test("an order number keeps its zeros, so it does not match every phone with that digit", () => {
  expect(parseClauses(orderSearchFilter("WEB-000006"))[2]).toEqual(["contact_phone.ilike.", "%000006%"]);
});

test("a term without digits has no phone clause", () => {
  expect(orderSearchFilter("Asha")).not.toContain("contact_phone");
});

test("search covers every status: it adds no status filter", async () => {
  await searchOrders("  WEB-000007 ");
  expect(opsOf("orders").map((o) => o[0])).not.toContain("in");
  expect(orOf()).toBe(orderSearchFilter("WEB-000007"));
});

test("an empty term runs no query", async () => {
  await expect(searchOrders("   ")).resolves.toEqual([]);
  expect(mockCalls).toEqual([]);
});

test("a long term is capped at 100 characters", async () => {
  await searchOrders("a".repeat(150));
  expect(orOf()).toBe(orderSearchFilter("a".repeat(100)));
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
