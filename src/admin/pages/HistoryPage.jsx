import React, { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { formatDateTimeIST } from "../../utility/dateFormat";
import { toast } from "sonner";

const PAGE_SIZE = 50;

const ACTIONS = ["create", "update", "delete"];
const ENTITY_TYPES = [
  "product", "variant", "stock", "mockup", "bill", "customer",
  "supplier", "supplier_bill", "discount", "category", "user", "salesperson",
];

const actionBadge = {
  create: "bg-green-100 text-green-700",
  update: "bg-blue-100 text-blue-700",
  delete: "bg-red-100 text-red-700",
};

export default function HistoryPage() {
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState([]);

  // filters
  const [actor, setActor] = useState("");
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, email")
        .order("email");
      setUsers(data || []);
    })();
  }, []);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let query = supabase
      .from("activity_log")
      .select(
        "id, created_at, actor_id, action, entity_type, entity_id, summary, profiles(email)",
        { count: "exact" }
      )
      .order("created_at", { ascending: false })
      .range(from, to);

    if (actor) query = query.eq("actor_id", actor);
    if (action) query = query.eq("action", action);
    if (entityType) query = query.eq("entity_type", entityType);
    if (dateFrom) query = query.gte("created_at", `${dateFrom}T00:00:00+05:30`);
    if (dateTo) query = query.lte("created_at", `${dateTo}T23:59:59+05:30`);
    if (search.trim()) query = query.ilike("summary", `%${search.trim()}%`);

    const { data, error, count: total } = await query;
    if (error) {
      toast.error("Failed to load history");
      setRows([]);
      setCount(0);
    } else {
      setRows(data || []);
      setCount(total || 0);
    }
    setLoading(false);
  }, [page, actor, action, entityType, dateFrom, dateTo, search]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  // Any filter change resets to first page.
  useEffect(() => {
    setPage(0);
  }, [actor, action, entityType, dateFrom, dateTo, search]);

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const inputCls =
    "border rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500";

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">History Log</h1>

      <div className="flex flex-wrap gap-2 items-center">
        <select className={inputCls} value={actor} onChange={(e) => setActor(e.target.value)}>
          <option value="">All users</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>{u.email}</option>
          ))}
        </select>
        <select className={inputCls} value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">All actions</option>
          {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select className={inputCls} value={entityType} onChange={(e) => setEntityType(e.target.value)}>
          <option value="">All types</option>
          {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input type="date" className={inputCls} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <input type="date" className={inputCls} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        <input
          type="text"
          placeholder="Search summary…"
          className={`${inputCls} flex-1 min-w-[180px]`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="bg-white rounded shadow overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-100 text-gray-600">
            <tr>
              <th className="text-left px-3 py-2 whitespace-nowrap">Time (IST)</th>
              <th className="text-left px-3 py-2 whitespace-nowrap">User</th>
              <th className="text-left px-3 py-2">Action</th>
              <th className="text-left px-3 py-2">Type</th>
              <th className="text-left px-3 py-2">Summary</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-400">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-400">No entries</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-3 py-2 whitespace-nowrap">{formatDateTimeIST(r.created_at)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.profiles?.email || "—"}</td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${actionBadge[r.action] || "bg-gray-100 text-gray-700"}`}>
                      {r.action}
                    </span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.entity_type}</td>
                  <td className="px-3 py-2">{r.summary}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-gray-600">
        <span>{count} entries</span>
        <div className="flex items-center gap-2">
          <button
            className="px-3 py-1 border rounded disabled:opacity-40"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >Prev</button>
          <span>Page {page + 1} / {totalPages}</span>
          <button
            className="px-3 py-1 border rounded disabled:opacity-40"
            disabled={page + 1 >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >Next</button>
        </div>
      </div>
    </div>
  );
}
