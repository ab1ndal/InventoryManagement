// src/admin/pages/BillingPage.js
import React, { useState } from "react";
import BillTable from "../components/BillTable";
import BillingForm from "../components/BillForm";
import { Button } from "../../components/ui/button";

export default function BillingPage() {
  const [activeBillId, setActiveBillId] = useState(null);

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Billing</h1>
        {!activeBillId && (
          <Button onClick={() => setActiveBillId("new")}>New Bill</Button>
        )}
      </div>
      {activeBillId ? (
        <BillingForm
          key={activeBillId}
          billId={activeBillId}
          onClose={() => setActiveBillId(null)}
        />
      ) : (
        <BillTable onEdit={(id) => setActiveBillId(id)} />
      )}
    </div>
  );
}
