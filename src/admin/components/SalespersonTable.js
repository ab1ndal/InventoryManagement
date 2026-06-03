import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Pencil, Check, X } from "lucide-react";
import { toast } from "sonner";
import { logActivity } from "../../lib/activityLog";
import { diffFields } from "../../utility/activitySummary";

export default function SalespersonTable({ refresh }) {
  const [salespersons, setSalespersons] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editValues, setEditValues] = useState({ name: "", date_hired: "", active: true });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchSalespersons();
  }, [refresh]);

  const fetchSalespersons = async () => {
    const { data, error } = await supabase
      .from("salespersons")
      .select("salesperson_id, name, date_hired, active")
      .order("salesperson_id");
    if (!error) setSalespersons(data);
    else console.error("Error loading salespersons:", error.message);
  };

  const startEdit = (s) => {
    setEditingId(s.salesperson_id);
    setEditValues({
      name: s.name,
      date_hired: s.date_hired || "",
      active: s.active ?? true,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValues({ name: "", date_hired: "", active: true });
  };

  const saveEdit = async (salesperson_id) => {
    if (!editValues.name.trim()) {
      toast.error("Name is required");
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("salespersons")
      .update({
        name: editValues.name.trim(),
        date_hired: editValues.date_hired || null,
        active: editValues.active,
      })
      .eq("salesperson_id", salesperson_id);
    setSaving(false);
    if (error) {
      toast.error("Failed to save", { description: error.message });
    } else {
      const old = salespersons.find((s) => s.salesperson_id === salesperson_id);
      const changed = diffFields(old || {}, editValues, ["name", "date_hired", "active"]);
      logActivity({ action: "update", entityType: "salesperson", entityId: salesperson_id, summary: `Edited salesperson ${editValues.name || old?.name || salesperson_id}${changed ? ` — ${changed}` : ""}` });
      toast.success("Salesperson updated");
      setEditingId(null);
      fetchSalespersons();
    }
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full border text-sm">
        <thead className="bg-muted">
          <tr>
            <th className="px-3 py-2 text-left w-8">#</th>
            <th className="px-3 py-2 text-left w-48">Name</th>
            <th className="px-3 py-2 text-left w-36">Date Hired</th>
            <th className="px-3 py-2 text-center w-24">Status</th>
            <th className="px-3 py-2 text-center w-24">Actions</th>
          </tr>
        </thead>
        <tbody>
          {salespersons.map((s) => {
            const isEditing = editingId === s.salesperson_id;
            return (
              <tr key={s.salesperson_id} className="border-t hover:bg-gray-50">
                <td className="px-3 py-2 text-muted-foreground font-mono text-xs">
                  {s.salesperson_id}
                </td>
                <td className="px-3 py-2">
                  {isEditing ? (
                    <Input
                      value={editValues.name}
                      onChange={(e) => setEditValues((v) => ({ ...v, name: e.target.value }))}
                      className="h-8 text-sm"
                      autoFocus
                    />
                  ) : (
                    <span className="font-medium">{s.name}</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {isEditing ? (
                    <Input
                      type="date"
                      value={editValues.date_hired}
                      onChange={(e) => setEditValues((v) => ({ ...v, date_hired: e.target.value }))}
                      className="h-8 text-sm"
                    />
                  ) : (
                    <span className="text-muted-foreground">
                      {s.date_hired || "—"}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-center">
                  {isEditing ? (
                    <div className="flex items-center justify-center gap-2">
                      <input
                        type="checkbox"
                        checked={editValues.active}
                        onChange={(e) => setEditValues((v) => ({ ...v, active: e.target.checked }))}
                        className="h-4 w-4 rounded border-gray-300"
                      />
                      <span className="text-xs text-muted-foreground">Active</span>
                    </div>
                  ) : (
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        s.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {s.active ? "Active" : "Inactive"}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-center">
                  {isEditing ? (
                    <div className="flex justify-center gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => saveEdit(s.salesperson_id)}
                        disabled={saving}
                        className="group"
                      >
                        <Check className="h-4 w-4 text-green-500 group-hover:text-green-700 transition-colors duration-200" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={cancelEdit}
                        disabled={saving}
                        className="group"
                      >
                        <X className="h-4 w-4 text-gray-400 group-hover:text-gray-700 transition-colors duration-200" />
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => startEdit(s)}
                      className="group"
                    >
                      <Pencil className="h-4 w-4 text-yellow-500 group-hover:text-blue-500 transition-colors duration-200" />
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
          {salespersons.length === 0 && (
            <tr>
              <td colSpan={5} className="px-3 py-4 text-center text-muted-foreground">
                No salespersons found.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
