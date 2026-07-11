import React, { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { toast } from "sonner";
import Seo from "../components/Seo";
import { supabase } from "lib/supabaseClient";
import { useStorefrontAuth } from "../context/StorefrontAuthContext";

const EMPTY = { first_name: "", last_name: "", phone: "", address: "", gender: "" };

export default function AccountPage() {
  const { user, loading, signOut } = useStorefrontAuth();
  const [form, setForm] = useState(EMPTY);
  const [loadingCustomer, setLoadingCustomer] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    let active = true;
    supabase.rpc("resolve_my_customer").then(({ data }) => {
      if (!active) return;
      const row = Array.isArray(data) ? data[0] : data;
      if (row) setForm({
        first_name: row.first_name ?? "", last_name: row.last_name ?? "",
        phone: row.phone ?? "", address: row.address ?? "", gender: row.gender ?? "",
      });
      setLoadingCustomer(false);
    });
    return () => { active = false; };
  }, [user]);

  if (!loading && !user) return <Navigate to="/login" replace />;

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function onSave(e) {
    e.preventDefault();
    setSaving(true);
    const { data, error } = await supabase.rpc("update_my_customer", {
      p_first_name: form.first_name, p_last_name: form.last_name,
      p_phone: form.phone, p_address: form.address, p_gender: form.gender,
    });
    setSaving(false);
    if (error) { toast.error("Couldn't save your details."); return; }
    const row = Array.isArray(data) ? data[0] : data;
    toast.success(row?.needs_review ? "Saved — our team will confirm your details." : "Details saved.");
  }

  return (
    <div className="max-w-lg mx-auto px-4 sm:px-6 py-12">
      <Seo title="My account" noindex />
      <div className="flex items-center justify-between mb-8">
        <h1 className="font-display text-3xl font-semibold text-storefront-charcoal">My account</h1>
        <button onClick={signOut} className="text-xs font-sans tracking-widest uppercase text-storefront-muted hover:text-storefront-charcoal">
          Sign out
        </button>
      </div>
      <p className="text-sm font-sans text-storefront-muted mb-8">{user?.email}</p>

      <form onSubmit={onSave} className="space-y-4">
        {[
          ["first_name", "First name"], ["last_name", "Last name"],
          ["phone", "Phone"], ["address", "Address"],
        ].map(([k, label]) => (
          <div key={k}>
            <label className="block text-xs font-sans tracking-wide text-storefront-charcoal mb-1">{label}</label>
            <input
              value={form[k]}
              onChange={set(k)}
              disabled={loadingCustomer}
              className="w-full border border-storefront-border bg-white px-3 py-2.5 text-sm font-sans focus:outline-none focus:border-storefront-gold"
            />
          </div>
        ))}
        <button type="submit" disabled={saving || loadingCustomer}
          className="bg-storefront-charcoal text-storefront-cream font-sans text-xs tracking-widest uppercase py-3 px-6 hover:bg-storefront-warm transition-colors disabled:opacity-40">
          {saving ? "Saving…" : "Save details"}
        </button>
      </form>

      <Link to="/account/orders" className="inline-block mt-8 text-xs font-sans tracking-wide text-storefront-muted hover:text-storefront-gold underline underline-offset-2">
        Order history
      </Link>
    </div>
  );
}
