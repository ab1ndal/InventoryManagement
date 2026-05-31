import { useState } from "react";
import SalespersonForm from "../components/SalespersonForm";
import SalespersonTable from "../components/SalespersonTable";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../../components/ui/dialog";

export default function SalespersonsPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [refresh, setRefresh] = useState(false);

  const handleSuccess = () => {
    setDialogOpen(false);
    setRefresh((r) => !r);
  };

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold">Salespersons</h2>
        <Button onClick={() => setDialogOpen(true)}>Add Salesperson</Button>
      </div>

      <SalespersonTable refresh={refresh} />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md bg-white">
          <DialogHeader>
            <DialogTitle>Add Salesperson</DialogTitle>
            <DialogDescription>
              Fill in the details to add a new salesperson.
            </DialogDescription>
          </DialogHeader>
          <SalespersonForm
            onSuccess={handleSuccess}
            onCancel={() => setDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
