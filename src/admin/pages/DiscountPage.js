// src/admin/pages/DiscountPage.js
import { useState } from "react";
import DiscountForm from "../components/DiscountForm";
import DiscountTable from "../components/DiscountTable";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../../components/ui/dialog";

export default function DiscountPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedDiscount, setSelectedDiscount] = useState(null);
  const [refresh, setRefresh] = useState(false);

  const handleCreate = () => {
    setSelectedDiscount(null);
    setDialogOpen(true);
  };

  const handleEdit = (discount) => {
    setSelectedDiscount(discount);
    setDialogOpen(true);
  };

  const handleSuccess = () => {
    setDialogOpen(false);
    setSelectedDiscount(null);
    setRefresh((r) => !r);
  };

  const handleClose = () => {
    setDialogOpen(false);
    setSelectedDiscount(null);
  };

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold">Discounts</h2>
        <Button onClick={handleCreate}>Add Discount</Button>
      </div>

      <DiscountTable onEdit={handleEdit} refresh={refresh} />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-white">
          <DialogHeader>
            <DialogTitle>
              {selectedDiscount ? "Edit Discount" : "Add Discount"}
            </DialogTitle>
            <DialogDescription>
              {selectedDiscount
                ? `Editing discount${selectedDiscount.code ? ` "${selectedDiscount.code}"` : ""}`
                : "Fill in the details below to create a new discount."}
            </DialogDescription>
          </DialogHeader>

          <DiscountForm
            defaultValues={selectedDiscount}
            onSuccess={handleSuccess}
            onCancel={handleClose}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
