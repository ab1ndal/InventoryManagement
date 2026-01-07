// src/admin/pages/BillingPage.js
import React, { useState } from "react";
import BillTable from "../components/BillTable";
import BillingForm from "../components/billing/BillingForm";
import { Button } from "../../components/ui/button";

export default function BillingPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [activeBillId, setActiveBillId] = useState(null);
  const [refreshTable, setRefreshTable] = useState(0);

  const handleBillEdit = (id) => {
    setActiveBillId(id);
    setDialogOpen(true);
  };

  const handleNewBill = () => {
    setActiveBillId(null);
    setDialogOpen(true);
  };

  const handleFormSubmit = () => {
    setDialogOpen(false);
    setActiveBillId(null);
    setRefreshTable((prev) => prev + 1);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Billing</h1>
        <Button onClick={handleNewBill}>New Bill</Button>
      </div>
      <BillTable
        key={refreshTable}
        onEdit={(id) => {
          setActiveBillId(id);
          setDialogOpen(true);
        }}
      />
      <BillingForm
        key={activeBillId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleFormSubmit}
      />
    </div>
  );
}
