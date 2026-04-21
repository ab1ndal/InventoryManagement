// src/admin/pages/BillingPage.js
import React, { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import BillTable from "../components/BillTable";
import BillingForm from "../components/billing/BillingForm";
import { Button } from "../../components/ui/button";

export default function BillingPage() {
  const location = useLocation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [activeBillId, setActiveBillId] = useState(null);
  const [refreshTable, setRefreshTable] = useState(0);
  const [exchangeCredit, setExchangeCredit] = useState(null);         // { amount, label } | null
  const [prefilledCustomerId, setPrefilledCustomerId] = useState(null);

  // Consume route state from ExchangePage (Plan 02 handoff). Auto-open BillingForm with exchange credit.
  // Pitfall 4: clear window.history state after reading so back-nav does not re-open.
  useEffect(() => {
    const st = location.state;
    if (st && st.openNewBill && st.exchangeCredit) {
      setExchangeCredit(st.exchangeCredit);
      setPrefilledCustomerId(st.prefilledCustomerId || null);
      setActiveBillId(null);
      setDialogOpen(true);
      // Clear so back-nav/refresh does not re-trigger
      window.history.replaceState({}, "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleBillEdit = (id) => {
    setActiveBillId(id);
    setExchangeCredit(null);
    setPrefilledCustomerId(null);
    setDialogOpen(true);
  };

  const handleNewBill = () => {
    setActiveBillId(null);
    setExchangeCredit(null);
    setPrefilledCustomerId(null);
    setDialogOpen(true);
  };

  const handleFormSubmit = () => {
    setDialogOpen(false);
    setActiveBillId(null);
    setExchangeCredit(null);
    setPrefilledCustomerId(null);
    setRefreshTable((prev) => prev + 1);
  };

  const handleOpenChange = (open) => {
    setDialogOpen(open);
    if (!open) {
      // Per D-18: if staff close without finalizing, exchange is still complete (credit sits on customer).
      // Just clear local props so next open is clean.
      setExchangeCredit(null);
      setPrefilledCustomerId(null);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Billing</h1>
        <Button onClick={handleNewBill}>New Bill</Button>
      </div>
      <BillTable
        key={refreshTable}
        onEdit={handleBillEdit}
      />
      <BillingForm
        key={`${activeBillId}-${exchangeCredit?.label || ""}`}
        billId={activeBillId}
        open={dialogOpen}
        onOpenChange={handleOpenChange}
        onSubmit={handleFormSubmit}
        exchangeCredit={exchangeCredit}
        prefilledCustomerId={prefilledCustomerId}
      />
    </div>
  );
}
