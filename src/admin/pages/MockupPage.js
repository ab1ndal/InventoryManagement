// src/admin/pages/MockupPage.js
import React, { useEffect, useState, Suspense, lazy } from "react";
import { supabase } from "../../lib/supabaseClient";
import MockupTable from "../components/MockupTable";
//import { Toaster } from "../../components/ui/toaster";
import { Button } from "../../components/ui/button";
import TotalValuePage from "./TotalValuePage";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "../../components/ui/tabs";

const MockupGraphsPage = lazy(() => import("./MockupGraphsPage"));

function ChartSkeleton() {
  const bars = [88, 72, 95, 60, 80, 45, 67, 53, 78, 40];
  return (
    <div className="p-6 space-y-10 animate-pulse">
      {[0, 1].map((chart) => (
        <div key={chart}>
          <div className="h-5 w-56 bg-gray-200 rounded mb-5" />
          <div className="space-y-2">
            {bars.map((w, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="h-3 w-28 bg-gray-200 rounded shrink-0" />
                <div className="flex-1 bg-gray-100 rounded h-5 overflow-hidden">
                  <div
                    className="h-full bg-gray-200 rounded"
                    style={{ width: `${w}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

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
    <div className="p-4">
      <div className="flex justify-between items-center m-4 gap-4">
        <h1 className="text-xl font-semibold">Mockup Tracker</h1>
        <Button variant="secondary" onClick={() => window.location.reload()}>
          Refresh
        </Button>
      </div>

      <Tabs defaultValue="table">
        <TabsList>
          <TabsTrigger value="table">Table</TabsTrigger>
          <TabsTrigger value="graphs">Graphs</TabsTrigger>
          <TabsTrigger value="value">Total Value</TabsTrigger>
        </TabsList>

        <TabsContent value="table">
          <MockupTable canEdit={canEdit} />
        </TabsContent>

        <TabsContent value="graphs">
          <Suspense fallback={<ChartSkeleton />}>
            <MockupGraphsPage />
          </Suspense>
        </TabsContent>
        <TabsContent value="value">
          <TotalValuePage />
        </TabsContent>
      </Tabs>
    </div>
  );
}
