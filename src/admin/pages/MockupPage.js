// src/admin/pages/MockupPage.js
import React, { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import MockupTable from "../components/MockupTable";
import { Toaster } from "../../components/ui/toaster";
import { Button } from "../../components/ui/button";

export default function MockupPage() {
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadRole = async () => {
      setLoading(true);
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;
      if (!uid) {
        setRole(null);
        setLoading(false);
        return;
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", uid)
        .single();
      setRole(profile?.role || null);
      setLoading(false);
    };
    loadRole();
  }, []);

  if (loading) {
    return (
      <div className="h-64 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-t-4 border-orange-600 border-opacity-50"></div>
      </div>
    );
  }

  if (role !== "admin" && role !== "superadmin") {
    return <div className="p-6 text-center text-red-600">Access denied</div>;
  }

  const canEdit = role === "superadmin";

  return (
    <div>
      <div className="flex justify-between items-center m-4 gap-4">
        <h1 className="text-xl font-semibold">Mockup Tracker</h1>
        <Button variant="secondary" onClick={() => window.location.reload()}>
          Refresh
        </Button>
      </div>
      <MockupTable canEdit={canEdit} />
      <Toaster />
    </div>
  );
}
