import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Pencil, Check, X } from "lucide-react";
import { toast } from "sonner";
import { logActivity } from "../../lib/activityLog";
import { diffFields } from "../../utility/activitySummary";

export default function CategoryTable({ refresh }) {
  const [categories, setCategories] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editValues, setEditValues] = useState({ name: "", description: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchCategories();
  }, [refresh]);

  const fetchCategories = async () => {
    const { data, error } = await supabase
      .from("categories")
      .select("categoryid, name, description")
      .order("name");
    if (!error) setCategories(data);
    else console.error("Error loading categories:", error.message);
  };

  const startEdit = (c) => {
    setEditingId(c.categoryid);
    setEditValues({ name: c.name, description: c.description || "" });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValues({ name: "", description: "" });
  };

  const saveEdit = async (categoryid) => {
    if (!editValues.name.trim()) {
      toast.error("Name is required");
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("categories")
      .update({ name: editValues.name.trim(), description: editValues.description.trim() || null })
      .eq("categoryid", categoryid);
    setSaving(false);
    if (error) {
      toast.error("Failed to save", { description: error.message });
    } else {
      const old = categories.find((c) => c.categoryid === categoryid);
      const changed = diffFields(old || {}, editValues, ["name", "description"]);
      logActivity({ action: "update", entityType: "category", entityId: categoryid, summary: `Edited category ${editValues.name || old?.name || categoryid}${changed ? ` — ${changed}` : ""}` });
      toast.success("Category updated");
      setEditingId(null);
      fetchCategories();
    }
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full border text-sm">
        <thead className="bg-muted">
          <tr>
            <th className="px-3 py-2 text-left w-28">ID</th>
            <th className="px-3 py-2 text-left w-48">Name</th>
            <th className="px-3 py-2 text-left">Description</th>
            <th className="px-3 py-2 text-center w-24">Actions</th>
          </tr>
        </thead>
        <tbody>
          {categories.map((c) => {
            const isEditing = editingId === c.categoryid;
            return (
              <tr key={c.categoryid} className="border-t hover:bg-gray-50">
                <td className="px-3 py-2 font-mono text-xs">{c.categoryid}</td>
                <td className="px-3 py-2">
                  {isEditing ? (
                    <Input
                      value={editValues.name}
                      onChange={(e) => setEditValues((v) => ({ ...v, name: e.target.value }))}
                      className="h-8 text-sm"
                      autoFocus
                    />
                  ) : (
                    <span className="font-medium">{c.name}</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {isEditing ? (
                    <Input
                      value={editValues.description}
                      onChange={(e) => setEditValues((v) => ({ ...v, description: e.target.value }))}
                      className="h-8 text-sm"
                      placeholder="Optional description…"
                    />
                  ) : (
                    <span className="text-muted-foreground">{c.description || "—"}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-center">
                  {isEditing ? (
                    <div className="flex justify-center gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => saveEdit(c.categoryid)}
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
                      onClick={() => startEdit(c)}
                      className="group"
                    >
                      <Pencil className="h-4 w-4 text-yellow-500 group-hover:text-blue-500 transition-colors duration-200" />
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
          {categories.length === 0 && (
            <tr>
              <td colSpan={4} className="px-3 py-4 text-center text-muted-foreground">
                No categories found.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
