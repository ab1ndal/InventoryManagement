// src/admin/pages/DiscountPage.js
import React, { useState, useEffect } from "react";
import DiscountForm from "../components/DiscountForm";
import DiscountTable from "../components/DiscountTable";
import { Button } from "../../components/ui/button";

export default function DiscountPage() {
  const [showForm, setShowForm] = useState(false);
  const [selectedDiscount, setSelectedDiscount] = useState(null);
  const [refresh, setRefresh] = useState(false);

  const handleCreate = () => {
    setSelectedDiscount(null);
    setShowForm(true);
  };

  const handleEdit = (discount) => {
    setSelectedDiscount(discount);
    setShowForm(true);
  };

  const handleSuccess = () => {
    setShowForm(false);
    setSelectedDiscount(null);
    setRefresh(!refresh);
  };

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold">Discounts</h2>
        <Button onClick={handleCreate}>Add Discount</Button>
      </div>
      {showForm && (
        <DiscountForm
          selectedDiscount={selectedDiscount}
          onSuccess={handleSuccess}
        />
      )}
      <div className="mt-6">
        <DiscountTable onEdit={handleEdit} refresh={refresh} />
      </div>
    </div>
  );
}
