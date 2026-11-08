// Test stand-in for the supabase-js client used by src/admin/lib modules.
// Records every query (table, op, filters, row) and resolves with the canned
// result for `${table}.${op}` (or `rpc.${fn}`); missing keys resolve to
// { data: null, error: null }. A result may be a function of the call.
// Storage calls resolve `storage.${op}` (upload, remove, createSignedUrl, download).
export function fakeSupabase(results = {}) {
  const calls = [];
  const resolve = (key, call) => {
    const r = results[key];
    return Promise.resolve(typeof r === "function" ? r(call) : r ?? { data: null, error: null });
  };
  const from = (table) => {
    const call = { table, op: "select", filters: [], row: null };
    calls.push(call);
    const filter = (kind) => (...args) => {
      call.filters.push([kind, ...args]);
      return builder;
    };
    const builder = {
      select: () => builder,
      insert: (row) => {
        call.op = "insert";
        call.row = row;
        return builder;
      },
      update: (row) => {
        call.op = "update";
        call.row = row;
        return builder;
      },
      delete: () => {
        call.op = "delete";
        return builder;
      },
      eq: filter("eq"),
      ilike: filter("ilike"),
      in: filter("in"),
      gt: filter("gt"),
      gte: filter("gte"),
      lte: filter("lte"),
      or: filter("or"),
      order: () => builder,
      limit: () => builder,
      single: () => builder,
      maybeSingle: () => builder,
      then: (onOk, onErr) => resolve(`${table}.${call.op}`, call).then(onOk, onErr),
    };
    return builder;
  };
  const rpc = (fn, args) => {
    const call = { table: null, op: "rpc", fn, args };
    calls.push(call);
    return resolve(`rpc.${fn}`, call);
  };
  const storage = {
    from: (bucket) => {
      const op = (name) => (...args) => {
        const call = { table: null, op: `storage.${name}`, bucket, args };
        calls.push(call);
        return resolve(`storage.${name}`, call);
      };
      return { upload: op("upload"), remove: op("remove"), createSignedUrl: op("createSignedUrl"), download: op("download") };
    },
  };
  // The signed-in user, if the test sets results.session.
  const auth = { getSession: async () => ({ data: { session: results.session ?? null }, error: null }) };
  return { from, rpc, auth, storage, calls };
}
