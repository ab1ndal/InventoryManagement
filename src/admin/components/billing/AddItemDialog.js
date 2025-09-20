import { useState } from "react";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../../../components/ui/dialog";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "../../../components/ui/tabs";
import { Button } from "../../../components/ui/button";
import InventoryPicker from "./InventoryPicker";
import ManualItemForm from "./ManualItemForm";

export default function AddItemDialog({ onAdd }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Add item</Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Add Product</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="inventory">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="inventory">From Inventory</TabsTrigger>
            <TabsTrigger value="manual">Manual Item</TabsTrigger>
          </TabsList>
          <TabsContent value="inventory">
            <InventoryPicker
              onPicked={(p) => {
                onAdd(p);
                setOpen(false);
              }}
            />
          </TabsContent>
          <TabsContent value="manual">
            <ManualItemForm
              onAdd={(p) => {
                onAdd(p);
                setOpen(false);
              }}
            />
          </TabsContent>
        </Tabs>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
