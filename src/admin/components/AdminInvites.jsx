import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { toast } from "../../components/hooks/use-toast";
import { logActivity } from "../../lib/activityLog";

const INVITE_ROLES = [
  { value: "admin", label: "Admin" },
  { value: "superadmin", label: "Super Admin" },
];
const DUPLICATE_KEY = "23505";

export default function AdminInvites() {
  const [invites, setInvites] = useState([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("admin");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const { data, error } = await supabase
      .from("admin_invites")
      .select("email, role")
      .order("email");
    if (error) {
      console.error("Error fetching admin invites:", error);
      toast({ variant: "destructive", title: "Error", description: "Failed to load pending admins." });
      return;
    }
    setInvites(data);
  };

  useEffect(() => {
    load();
  }, []);

  const addInvite = async (e) => {
    e.preventDefault();
    const normalized = email.trim().toLowerCase();
    setSaving(true);
    const { error } = await supabase.from("admin_invites").insert({ email: normalized, role });
    setSaving(false);
    if (error) {
      console.error("Error adding admin invite:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: error.code === DUPLICATE_KEY ? "That email is already pending." : "Failed to add admin.",
      });
      return;
    }
    logActivity({
      action: "create",
      entityType: "user",
      entityId: normalized,
      summary: `Invited ${normalized} as ${role}`,
    });
    setEmail("");
    setRole("admin");
    toast({ title: "Success", description: `${normalized} can now sign in at the Admin login page.` });
    load();
  };

  const removeInvite = async (invite) => {
    const { error } = await supabase.from("admin_invites").delete().eq("email", invite.email);
    if (error) {
      console.error("Error removing admin invite:", error);
      toast({ variant: "destructive", title: "Error", description: "Failed to remove invite." });
      return;
    }
    logActivity({
      action: "delete",
      entityType: "user",
      entityId: invite.email,
      summary: `Removed invite for ${invite.email}`,
    });
    setInvites((prev) => prev.filter((i) => i.email !== invite.email));
  };

  return (
    <div className="rounded-md border p-4 space-y-3">
      <h3 className="font-medium">Add admin</h3>
      <form onSubmit={addInvite} className="flex flex-wrap items-center gap-2">
        <label htmlFor="invite-email" className="sr-only">Email</label>
        <input
          id="invite-email"
          type="email"
          required
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="px-3 py-2 border rounded text-sm flex-1 min-w-[220px]"
        />
        <label htmlFor="invite-role" className="sr-only">Role</label>
        <select
          id="invite-role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="px-3 py-2 border rounded text-sm bg-white"
        >
          {INVITE_ROLES.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
        <button
          type="submit"
          disabled={saving}
          className="px-3 py-2 text-sm bg-amber-600 text-white rounded hover:bg-amber-700 transition disabled:opacity-50"
        >
          Add
        </button>
      </form>
      {invites.length > 0 && (
        <ul className="text-sm divide-y">
          {invites.map((invite) => (
            <li key={invite.email} className="flex items-center justify-between py-2">
              <span>
                {invite.email} · {INVITE_ROLES.find((r) => r.value === invite.role)?.label} · waiting for first sign-in
              </span>
              <button
                type="button"
                onClick={() => removeInvite(invite)}
                className="text-xs px-3 py-1 rounded border border-red-400 text-red-500 hover:bg-red-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
