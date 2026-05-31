// src/admin/pages/SuppliersPage.js
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import SupplierTable from "../components/SupplierTable";
import SupplierForm from "../components/SupplierForm";
import SupplierTransactionDialog from "../components/SupplierTransactionDialog";
import SupplierLedgerDialog from "../components/SupplierLedgerDialog";
import SupplierTransactionsTab from "../components/SupplierTransactionsTab";

export default function SuppliersPage() {
  const [formOpen, setFormOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState(null);

  const [txnDialogOpen, setTxnDialogOpen] = useState(false);
  const [txnSupplier, setTxnSupplier] = useState(null);
  const [txnDefaultType, setTxnDefaultType] = useState("bill");

  const [ledgerDialogOpen, setLedgerDialogOpen] = useState(false);
  const [ledgerSupplier, setLedgerSupplier] = useState(null);

  const [refreshSignal, setRefreshSignal] = useState(0);

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold">Supplier Management</h2>

      <Tabs defaultValue="suppliers">
        <TabsList>
          <TabsTrigger value="suppliers">Suppliers</TabsTrigger>
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
        </TabsList>

        <TabsContent value="suppliers" className="space-y-4 pt-4">
          <div className="flex justify-end">
            <Button
              onClick={() => {
                setEditingSupplier(null);
                setFormOpen(true);
              }}
            >
              Add Supplier
            </Button>
          </div>

          <SupplierTable
            refreshSignal={refreshSignal}
            onEditSupplier={(s) => {
              setEditingSupplier(s);
              setFormOpen(true);
            }}
            onAddTransaction={(s) => {
              setTxnSupplier(s);
              setTxnDialogOpen(true);
            }}
            onViewLedger={(s) => {
              setLedgerSupplier(s);
              setLedgerDialogOpen(true);
            }}
          />
        </TabsContent>

        <TabsContent value="transactions" className="pt-4">
          <SupplierTransactionsTab />
        </TabsContent>
      </Tabs>

      {formOpen && (
        <SupplierForm
          defaultValues={editingSupplier}
          onSubmit={() => {
            setFormOpen(false);
            setEditingSupplier(null);
            setRefreshSignal((p) => p + 1);
          }}
          openExternally={formOpen}
          setOpenExternally={setFormOpen}
          triggerLabel={editingSupplier ? "Edit Supplier" : "Add Supplier"}
        />
      )}

      {txnSupplier && (
        <SupplierTransactionDialog
          supplier={txnSupplier}
          open={txnDialogOpen}
          onOpenChange={setTxnDialogOpen}
          defaultType={txnDefaultType}
          onSuccess={() => {
            setTxnDialogOpen(false);
            setRefreshSignal((p) => p + 1);
          }}
        />
      )}

      {ledgerSupplier && (
        <SupplierLedgerDialog
          supplier={ledgerSupplier}
          open={ledgerDialogOpen}
          onOpenChange={setLedgerDialogOpen}
          onAddTransaction={(defaultType) => {
            setLedgerDialogOpen(false);
            setTxnSupplier(ledgerSupplier);
            setTxnDefaultType(defaultType);
            setTxnDialogOpen(true);
          }}
        />
      )}
    </div>
  );
}
