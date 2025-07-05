// src/admin/pages/CustomersPage.js
import React, { useState } from "react";
import CustomerTable from "../components/CustomerTable";
import CustomerForm from "../components/CustomerForm";
import { Button } from "../../components/ui/button";

export default function CustomersPage() {
  const [formOpen, setFormOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [refreshTable, setRefreshTable] = useState(0); // signal to refresh CustomerTable

  const handleEdit = (customer) => {
    setEditingCustomer(customer);
    setFormOpen(true);
  };

  const handleFormSuccess = () => {
    setFormOpen(false);
    setEditingCustomer(null);
    setRefreshTable((prev) => prev + 1); // trigger refetch
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold">Customer Management</h2>
      </div>

      <CustomerTable onEditCustomer={handleEdit} refreshSignal={refreshTable} />

      {formOpen && (
        <CustomerForm
          defaultValues={editingCustomer}
          onSubmit={handleFormSuccess}
          triggerLabel={editingCustomer ? "Edit Customer" : "Add Customer"}
          openExternally={formOpen}
          setOpenExternally={setFormOpen}
        />
      )}
    </div>
  );
}
