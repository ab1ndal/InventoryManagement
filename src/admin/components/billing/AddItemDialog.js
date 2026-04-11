import { useState } from "react";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
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

/**
 * Used in two modes:
 *  - Add mode (default): uncontrolled open state, triggered by a button.
 *    Calls onAdd(item) on confirm.
 *  - Edit mode: controlled via open/onOpenChange props, no trigger button.
 *    Calls onUpdate(item) on confirm, preserving the original _id.
 */
export default function AddItemDialog({
  onAdd,
  editItem,
  onUpdate,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const [activeTab, setActiveTab] = useState(null);
  const isEditing = !!editItem;

  const open = controlledOpen !== undefined ? controlledOpen : uncontrolledOpen;
  const setOpen =
    controlledOpen !== undefined ? controlledOnOpenChange : setUncontrolledOpen;

  const defaultTab =
    isEditing && editItem.source === "manual" ? "manual" : "inventory";

  const handleConfirm = (item) => {
    if (isEditing) {
      onUpdate({ ...item, _id: editItem._id });
    } else {
      onAdd(item);
    }
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!isEditing && (
        <DialogTrigger asChild>
          <Button>Add item</Button>
        </DialogTrigger>
      )}
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Item" : "Add Product"}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Update the item details below"
              : "Select a product from inventory or add a manual item"}
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue={defaultTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="inventory">From Inventory</TabsTrigger>
            <TabsTrigger value="manual">Manual Item</TabsTrigger>
          </TabsList>
          <TabsContent value="inventory">
            <InventoryPicker
              initialVal={
                isEditing && editItem.source === "inventory"
                  ? editItem
                  : undefined
              }
              onPicked={handleConfirm}
            />
          </TabsContent>
          <TabsContent value="manual">
            <ManualItemForm
              initialVal={
                isEditing && editItem.source === "manual" ? editItem : undefined
              }
              onAdd={handleConfirm}
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
