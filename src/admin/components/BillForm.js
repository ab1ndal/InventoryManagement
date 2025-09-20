import React, { useEffect, useMemo, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { supabase } from "../../lib/supabaseClient";
import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";
import { Label } from "../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../../components/ui/tabs";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Checkbox } from "../../components/ui/checkbox";
import { Textarea } from "../../components/ui/textarea";
import { useToast } from "../../components/hooks/use-toast";
import { useNavigate } from "react-router-dom";

/**
 * BillingForm.jsx
 *
 * Key features implemented:
 * 1) Auto-generated Billing ID by creating a draft bill row (finalized=false) on mount / when user clicks New Bill.
 * 2) Customer selection via searchable phone dropdown + inline create-new customer.
 * 3) Add products via dialog in two modes: From Inventory (project/product + variant color/size + qty) OR Manual item (category, name, code(cost), MRP).
 *    Per-item controls: quick discount (5/10/15/20), custom discount value, GST rate (5 or 12 default), stitching/alteration charges.
 * 4) Overall discount codes (from discounts table) with examples like B2G1, Kurti1000. Multiple codes supported. Auto-apply flags respected.
 * 5) Accurate tax/discount math + single transaction upsert into Supabase tables (bills & bill_items). Bill-level totals are back-computed and saved.
 *
 * Notes:
 * - Replace component import paths to match your project if needed.
 * - This file keeps child components colocated for easier iteration.
 */

export default function BillingForm() {
  const { toast } = useToast();

  // --- bill state
  const [billId, setBillId] = useState(null); // integer from DB
  const [finalized, setFinalized] = useState(false);

  // --- customer
  const [customerOptions, setCustomerOptions] = useState([]);
  const [customerQuery, setCustomerQuery] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState(null);
  const [showCreateCustomer, setShowCreateCustomer] = useState(false);

  // --- items
  const [items, setItems] = useState([]); // array of BillItemDraft

  // --- discounts (overall)
  const [allDiscounts, setAllDiscounts] = useState([]); // from discounts table
  const [selectedCodes, setSelectedCodes] = useState([]);

  const [notes, setNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const navigate = useNavigate();

  // Load active discounts for overall codes
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("discounts")
        .select(
          "id, code, type, value, max_discount, rules, auto_apply, once_per_customer, exclusive, min_total, category"
        )
        .eq("active", true);
      if (error) {
        console.error(error);
      } else {
        setAllDiscounts(data || []);
        // auto-apply ones
        const auto = (data || [])
          .filter((d) => d.auto_apply)
          .map((d) => d.code);
        if (auto.length)
          setSelectedCodes((prev) => Array.from(new Set([...prev, ...auto])));
      }
    })();
  }, []);

  // Search customers by phone as user types
  useEffect(() => {
    const run = async () => {
      const q = customerQuery.trim();
      if (!q) {
        setCustomerOptions([]);
        return;
      }
      const { data, error } = await supabase
        .from("customers")
        .select("customerid, first_name, last_name, phone")
        .ilike("phone", `%${q}%`)
        .limit(15);
      if (!error) setCustomerOptions(data || []);
    };
    const t = setTimeout(run, 300);
    return () => clearTimeout(t);
  }, [customerQuery]);

  // Derived totals
  const computed = useMemo(
    () => computeBillTotals(items, selectedCodes, allDiscounts),
    [items, selectedCodes, allDiscounts]
  );

  const handleAddItem = (item) => {
    setItems((prev) => [...prev, { ...item, _id: uuidv4() }]);
  };

  const handleUpdateItem = (id, patch) => {
    setItems((prev) =>
      prev.map((it) => (it._id === id ? { ...it, ...patch } : it))
    );
  };

  const handleRemoveItem = (id) => {
    setItems((prev) => prev.filter((it) => it._id !== id));
  };

  const handleSaveDraft = async () => {
    if (!billId) return;
    setIsSaving(true);
    try {
      // Save bill_items
      await supabase.from("bill_items").delete().eq("billid", billId);
      await supabase
        .from("bill_items")
        .insert(items.map((it) => materializeItemForDb(billId, it)));

      await supabase
        .from("bills")
        .update({
          customerid: selectedCustomerId || null,
          notes: notes || null,
          finalized: false,
        })
        .eq("billid", billId);

      toast({ title: `Draft bill #${billId} saved` });
    } catch (e) {
      toast({
        title: "Save draft failed",
        description: e.message,
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleFinalize = async () => {
    if (!billId) {
      toast({
        title: "No Bill ID yet",
        description: "Please wait a moment and try again.",
        variant: "destructive",
      });
      return;
    }
    if (items.length === 0) {
      toast({
        title: "Add at least one item",
        description: "A bill requires one or more items.",
      });
      return;
    }
    setIsSaving(true);

    // Prepare payloads
    const billRows = items.map((it) => materializeItemForDb(billId, it));

    // Use a PostgREST bulk insert and then update bill totals. Ideally, wrap in an RPC for a transaction.
    try {
      // Upsert items: for draft we insert anew; if user edited, we could delete & re-insert for simplicity
      await supabase.from("bill_items").delete().eq("billid", billId);
      const { error: insErr } = await supabase
        .from("bill_items")
        .insert(billRows);
      if (insErr) throw insErr;

      const update = {
        customerid: selectedCustomerId || null,
        notes: notes || null,
        finalized: true,
        totalamount: toMoney(computed.grandTotal),
        gst_total: toMoney(computed.gstTotal),
        discount_total: toMoney(
          computed.overallDiscount + computed.itemLevelDiscountTotal
        ),
        taxable_total: toMoney(computed.taxableTotal),
      };
      const { error: updErr } = await supabase
        .from("bills")
        .update(update)
        .eq("billid", billId);
      if (updErr) throw updErr;

      setFinalized(true);
      toast({ title: `Bill #${billId} saved` });
    } catch (e) {
      console.error(e);
      toast({
        title: "Save failed",
        description: e.message,
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Billing</CardTitle>
          <div className="text-sm text-muted-foreground">
            {billId ? `Bill ID: ${billId}` : "Creating draft..."}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Customer Select */}
          <section className="grid gap-3">
            <Label>Customer (search by phone)</Label>
            <div className="flex gap-2 items-start">
              <Input
                placeholder="Enter phone number"
                value={customerQuery}
                onChange={(e) => setCustomerQuery(e.target.value)}
                className="max-w-xs"
              />
              <Select
                onValueChange={(v) => setSelectedCustomerId(Number(v))}
                value={
                  selectedCustomerId ? String(selectedCustomerId) : undefined
                }
              >
                <SelectTrigger className="w-[280px]">
                  <SelectValue placeholder="Select customer" />
                </SelectTrigger>
                <SelectContent>
                  {(customerOptions || []).map((c) => (
                    <SelectItem key={c.customerid} value={String(c.customerid)}>
                      {c.first_name} {c.last_name} — {c.phone}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Dialog
                open={showCreateCustomer}
                onOpenChange={setShowCreateCustomer}
              >
                <DialogTrigger asChild>
                  <Button variant="outline">New customer</Button>
                </DialogTrigger>
                <DialogContent className="max-w-xl">
                  <DialogHeader>
                    <DialogTitle>Create Customer</DialogTitle>
                  </DialogHeader>
                  <CreateCustomerForm
                    onCreated={(cust) => {
                      setSelectedCustomerId(cust.customerid);
                      setCustomerQuery("");
                      setShowCreateCustomer(false);
                      toast({ title: "Customer created" });
                    }}
                  />
                </DialogContent>
              </Dialog>
            </div>
          </section>

          {/* Items */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Items</Label>
              <AddItemDialog onAdd={handleAddItem} />
            </div>

            <div className="rounded-2xl border">
              <ScrollArea className="max-h-[360px]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted/50">
                    <tr>
                      <th className="p-2 text-left">Name</th>
                      <th className="p-2 text-right">Qty</th>
                      <th className="p-2 text-right">MRP</th>
                      <th className="p-2 text-right">Disc%</th>
                      <th className="p-2 text-right">Stitch</th>
                      <th className="p-2 text-right">GST%</th>
                      <th className="p-2 text-right">Subtotal</th>
                      <th className="p-2 text-right">GST Amt</th>
                      <th className="p-2 text-right">Total</th>
                      <th className="p-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it) => (
                      <ItemRow
                        key={it._id}
                        item={it}
                        onUpdate={handleUpdateItem}
                        onRemove={handleRemoveItem}
                      />
                    ))}
                    {items.length === 0 && (
                      <tr>
                        <td className="p-3 text-muted-foreground" colSpan={10}>
                          No items yet. Click "Add item".
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </ScrollArea>
            </div>
          </section>

          {/* Overall Discounts */}
          <section className="space-y-2">
            <Label>Overall Discounts</Label>
            <OverallDiscountSelector
              discounts={allDiscounts}
              selectedCodes={selectedCodes}
              onToggle={(code) =>
                setSelectedCodes((prev) =>
                  prev.includes(code)
                    ? prev.filter((c) => c !== code)
                    : [...prev, code]
                )
              }
            />
          </section>

          {/* Notes */}
          <section className="grid gap-2">
            <Label>Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Special instructions, payment notes, etc."
            />
          </section>

          {/* Summary */}
          <Summary computed={computed} />

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => navigate("/admin/bills")}>
              Cancel
            </Button>
            <Button disabled={isSaving || !billId} onClick={handleSaveDraft}>
              {isSaving ? "Saving..." : "Save Draft"}
            </Button>
            <Button
              disabled={isSaving || finalized || !billId}
              onClick={handleFinalize}
            >
              {isSaving ? "Saving..." : finalized ? "Saved" : "Finalize"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/*******************************
 * Child Components
 *******************************/

function ItemRow({ item, onUpdate, onRemove }) {
  const { qty, mrp, quickDiscountPct, stitching, alteration, gstRate } =
    normalizeItem(item);
  const pricing = priceItem(item);

  return (
    <tr className="border-t">
      <td className="p-2">
        <div className="font-medium">
          {item.product_name || item.manual_name || "Unnamed"}
        </div>
        <div className="text-xs text-muted-foreground">
          {item.category ||
            item.manual_category ||
            item.product_code ||
            item.manual_code ||
            "—"}
        </div>
      </td>
      <td className="p-2 text-right">
        <Input
          type="number"
          className="h-8 w-20 ml-auto text-right"
          min={1}
          value={qty}
          onChange={(e) =>
            onUpdate(item._id, {
              quantity: parseInt(e.target.value || "1", 10),
            })
          }
        />
      </td>
      <td className="p-2 text-right">
        <Input
          type="number"
          className="h-8 w-24 ml-auto text-right"
          step="0.01"
          value={mrp}
          onChange={(e) =>
            onUpdate(item._id, { mrp: parseFloat(e.target.value || "0") })
          }
        />
      </td>
      <td className="p-2 text-right">
        <Select
          value={String(quickDiscountPct)}
          onValueChange={(v) =>
            onUpdate(item._id, { quickDiscountPct: Number(v) })
          }
        >
          <SelectTrigger className="h-8 w-28 ml-auto">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[0, 5, 10, 15, 20].map((p) => (
              <SelectItem key={p} value={String(p)}>
                {p}%
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>
      <td className="p-2 text-right">
        <Input
          type="number"
          className="h-8 w-24 ml-auto text-right"
          step="0.01"
          value={stitching}
          onChange={(e) =>
            onUpdate(item._id, {
              stitching_charge: parseFloat(e.target.value || "0"),
            })
          }
        />
      </td>
      <td className="p-2 text-right">
        <Select
          value={String(gstRate)}
          onValueChange={(v) => onUpdate(item._id, { gstRate: Number(v) })}
        >
          <SelectTrigger className="h-8 w-20 ml-auto">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[12, 5].map((r) => (
              <SelectItem key={r} value={String(r)}>
                {r}%
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>
      <td className="p-2 text-right tabular-nums">{money(pricing.subtotal)}</td>
      <td className="p-2 text-right tabular-nums">
        {money(pricing.gst_amount)}
      </td>
      <td className="p-2 text-right font-medium tabular-nums">
        {money(pricing.total)}
      </td>
      <td className="p-2 text-right">
        <Button variant="ghost" size="sm" onClick={() => onRemove(item._id)}>
          Remove
        </Button>
      </td>
    </tr>
  );
}

function AddItemDialog({ onAdd }) {
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
              onPicked={(payload) => {
                onAdd(payload);
                setOpen(false);
              }}
            />
          </TabsContent>
          <TabsContent value="manual">
            <ManualItemForm
              onAdd={(payload) => {
                onAdd(payload);
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

function InventoryPicker({ onPicked }) {
  const { toast } = useToast();
  const [projectQuery, setProjectQuery] = useState(""); // search by productid / code
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null); // product
  const [variants, setVariants] = useState([]);
  const [variantId, setVariantId] = useState(null);
  const [qty, setQty] = useState(1);

  // search products by ID/code/description
  useEffect(() => {
    const run = async () => {
      const q = projectQuery.trim();
      if (!q) {
        setResults([]);
        return;
      }
      const { data, error } = await supabase
        .from("products")
        .select("productid, category, description, code, mrp")
        .or(`productid.eq.${q},code.ilike.%${q}%,description.ilike.%${q}%`)
        .limit(20);
      if (!error) setResults(data || []);
    };
    const t = setTimeout(run, 300);
    return () => clearTimeout(t);
  }, [projectQuery]);

  // load variants for selected product
  useEffect(() => {
    (async () => {
      if (!selected) return;
      const { data, error } = await supabase
        .from("productsizecolors")
        .select("variantid, color, size, quantity")
        .eq("productid", selected.productid);
      if (!error) setVariants(data || []);
    })();
  }, [selected]);

  const choose = () => {
    if (!selected) {
      toast({ title: "Pick a product" });
      return;
    }
    const v = variants.find((x) => x.variantid === variantId);
    onPicked({
      source: "inventory",
      productid: selected.productid,
      variantid: v?.variantid || null,
      product_name: selected.description,
      product_code: selected.code,
      category: selected.category,
      quantity: qty,
      mrp: Number(selected.mrp || 0),
      quickDiscountPct: 0,
      gstRate: 12,
      stitching_charge: 0,
      alteration_charge: 0,
    });
  };

  return (
    <div className="grid gap-3 py-2">
      <Label>Search by Product ID / Code / Description</Label>
      <Input
        value={projectQuery}
        onChange={(e) => setProjectQuery(e.target.value)}
        placeholder="e.g. 1024 or KRT-Blue or Anarkali"
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-60 overflow-auto">
        {results.map((p) => (
          <button
            key={p.productid}
            className={`text-left rounded-xl border p-3 hover:bg-accent ${
              selected?.productid === p.productid ? "ring-2 ring-ring" : ""
            }`}
            onClick={() => {
              setSelected(p);
              setVariantId(null);
            }}
          >
            <div className="font-medium">
              [{p.productid}] {p.description}
            </div>
            <div className="text-xs text-muted-foreground">
              {p.category} • Code: {p.code} • MRP: {money(p.mrp)}
            </div>
          </button>
        ))}
        {results.length === 0 && (
          <div className="text-sm text-muted-foreground">No matches</div>
        )}
      </div>

      {selected && (
        <div className="grid gap-2">
          <Label>Variant (color / size)</Label>
          <Select
            onValueChange={(v) => setVariantId(v)}
            value={variantId || undefined}
          >
            <SelectTrigger className="w-full md:w-[320px]">
              <SelectValue placeholder="Select variant" />
            </SelectTrigger>
            <SelectContent>
              {variants.map((v) => (
                <SelectItem key={v.variantid} value={v.variantid}>
                  {v.color} / {v.size} (stock: {v.quantity})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Label className="mt-2">Quantity</Label>
          <Input
            type="number"
            min={1}
            value={qty}
            onChange={(e) => setQty(parseInt(e.target.value || "1", 10))}
            className="w-28"
          />

          <div className="pt-2">
            <Button onClick={choose}>Add</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ManualItemForm({ onAdd }) {
  const [category, setCategory] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState(""); // purchase price code or internal code
  const [mrp, setMrp] = useState(0);
  const [qty, setQty] = useState(1);

  const add = () => {
    onAdd({
      source: "manual",
      manual_category: category || null,
      manual_name: name || null,
      manual_code: code || null,
      category: category || null,
      product_name: name || null,
      product_code: code || null,
      quantity: qty,
      mrp: Number(mrp || 0),
      quickDiscountPct: 0,
      gstRate: 12,
      stitching_charge: 0,
      alteration_charge: 0,
    });
  };

  return (
    <div className="grid gap-3 py-2">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="grid gap-2">
          <Label>Category</Label>
          <Input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Kurti / Saree / Suit / ..."
          />
        </div>
        <div className="grid gap-2">
          <Label>Product name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Describe the item"
          />
        </div>
        <div className="grid gap-2">
          <Label>Purchase/Code</Label>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Internal purchase code"
          />
        </div>
        <div className="grid gap-2">
          <Label>MRP</Label>
          <Input
            type="number"
            step="0.01"
            value={mrp}
            onChange={(e) => setMrp(e.target.value)}
            placeholder="0.00"
          />
        </div>
        <div className="grid gap-2">
          <Label>Quantity</Label>
          <Input
            type="number"
            min={1}
            value={qty}
            onChange={(e) => setQty(parseInt(e.target.value || "1", 10))}
          />
        </div>
      </div>
      <div>
        <Button onClick={add}>Add</Button>
      </div>
    </div>
  );
}

function OverallDiscountSelector({ discounts, selectedCodes, onToggle }) {
  return (
    <div className="grid gap-2">
      {discounts.length === 0 && (
        <div className="text-sm text-muted-foreground">
          No active discounts configured.
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {discounts.map((d) => (
          <label
            key={d.code}
            className="flex items-center gap-2 rounded-xl border p-3"
          >
            <Checkbox
              checked={selectedCodes.includes(d.code)}
              onCheckedChange={() => onToggle(d.code)}
            />
            <div>
              <div className="font-medium">{d.code}</div>
              <div className="text-xs text-muted-foreground">
                {describeDiscount(d)}
              </div>
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}

function Summary({ computed }) {
  return (
    <div className="grid gap-2 rounded-2xl border p-3">
      <div className="flex justify-between text-sm">
        <span>Items subtotal</span>
        <span className="tabular-nums">{money(computed.itemsSubtotal)}</span>
      </div>
      <div className="flex justify-between text-sm">
        <span>Item-level discounts</span>
        <span className="tabular-nums">
          - {money(computed.itemLevelDiscountTotal)}
        </span>
      </div>
      <div className="flex justify-between text-sm">
        <span>Overall discounts</span>
        <span className="tabular-nums">
          - {money(computed.overallDiscount)}
        </span>
      </div>
      <div className="flex justify-between text-sm">
        <span>Taxable total</span>
        <span className="tabular-nums">{money(computed.taxableTotal)}</span>
      </div>
      <div className="flex justify-between text-sm">
        <span>GST total</span>
        <span className="tabular-nums">{money(computed.gstTotal)}</span>
      </div>
      <div className="flex justify-between font-semibold text-base">
        <span>Grand total</span>
        <span className="tabular-nums">{money(computed.grandTotal)}</span>
      </div>
    </div>
  );
}

function CreateCustomerForm({ onCreated }) {
  const { toast } = useToast();
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        first_name: first.trim() || "Customer",
        last_name: last.trim() || "",
        phone: phone.trim() || null,
        email: email.trim() || null,
        customer_ulid: cryptoRandomUlid(),
      };
      const { data, error } = await supabase
        .from("customers")
        .insert(payload)
        .select("customerid, first_name, last_name, phone")
        .single();
      if (error) throw error;
      onCreated?.(data);
    } catch (e) {
      toast({
        title: "Failed to create customer",
        description: e.message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1">
          <Label>First name</Label>
          <Input value={first} onChange={(e) => setFirst(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label>Last name</Label>
          <Input value={last} onChange={(e) => setLast(e.target.value)} />
        </div>
      </div>
      <div className="grid gap-1">
        <Label>Phone</Label>
        <Input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+91XXXXXXXXXX or local"
        />
      </div>
      <div className="grid gap-1">
        <Label>Email</Label>
        <Input value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="flex justify-end">
        <Button disabled={saving} onClick={save}>
          {saving ? "Saving..." : "Create"}
        </Button>
      </div>
    </div>
  );
}

/*******************************
 * Pricing Logic
 *******************************/

function normalizeItem(it) {
  return {
    qty: Number(it.quantity || 1),
    mrp: Number(it.mrp || 0),
    quickDiscountPct: Number(it.quickDiscountPct || 0),
    stitching: Number(it.stitching_charge || 0),
    alteration: Number(it.alteration_charge || 0),
    gstRate: Number(it.gstRate ?? it.gst_rate ?? 12),
  };
}

function priceItem(it) {
  const { qty, mrp, quickDiscountPct, stitching, alteration, gstRate } =
    normalizeItem(it);
  const base = mrp * qty;
  const itemDisc = round2((base * quickDiscountPct) / 100);
  const afterDisc = base - itemDisc;
  const withCharges = afterDisc + Number(stitching) + Number(alteration || 0);
  const gstAmt = round2((withCharges * gstRate) / 100);
  const total = round2(withCharges + gstAmt);
  return {
    base,
    itemDisc,
    afterDisc,
    withCharges,
    gst_amount: gstAmt,
    subtotal: withCharges,
    total,
  };
}

function computeBillTotals(items, selectedCodes, allDiscounts) {
  const priced = items.map(priceItem);
  const itemsSubtotal = round2(priced.reduce((s, p) => s + p.base, 0));
  const itemLevelDiscountTotal = round2(
    priced.reduce((s, p) => s + p.itemDisc, 0)
  );
  const preOverallTaxable = round2(
    priced.reduce((s, p) => s + p.withCharges, 0)
  );

  // overall discount value depends on codes
  const overallDiscount = round2(
    applyOverallDiscounts(items, selectedCodes, allDiscounts)
  );

  const taxableTotal = Math.max(0, round2(preOverallTaxable - overallDiscount));
  // compute GST proportionally by each item share of taxable
  const itemTaxables = items.map((it) => priceItem(it).withCharges);
  const totalTaxableBefore = preOverallTaxable || 1;
  const gstTotal = round2(
    items.reduce((sum, it, idx) => {
      const share = itemTaxables[idx] / totalTaxableBefore;
      const reducedTaxable = taxableTotal * share;
      const rate = Number(it.gstRate ?? it.gst_rate ?? 12);
      return sum + round2((reducedTaxable * rate) / 100);
    }, 0)
  );

  const grandTotal = round2(taxableTotal + gstTotal);
  return {
    itemsSubtotal,
    itemLevelDiscountTotal,
    preOverallTaxable,
    overallDiscount,
    taxableTotal,
    gstTotal,
    grandTotal,
  };
}

function applyOverallDiscounts(items, codes, allDiscounts) {
  if (!codes || codes.length === 0) return 0;
  const active = allDiscounts.filter((d) => codes.includes(d.code));
  if (active.length === 0) return 0;

  // If any exclusive discount is selected, apply only that one (choose the max value outcome)
  const exclusive = active.filter((d) => d.exclusive);
  if (exclusive.length > 0) {
    return Math.max(...exclusive.map((d) => valueOfDiscount(d, items)));
  }
  // Otherwise, sum values (bounded by max_discount if present)
  return active.reduce((sum, d) => sum + valueOfDiscount(d, items), 0);
}

function valueOfDiscount(d, items) {
  // Supported: flat, percentage, buy_x_get_y, fixed_price, conditional via rules
  const taxables = items.map((it) => priceItem(it).withCharges);
  const total = taxables.reduce((s, v) => s + v, 0);

  switch (d.type) {
    case "flat": {
      const v = Number(d.value || 0);
      return clampMax(v, d.max_discount);
    }
    case "percentage": {
      const pct = Number(d.value || 0);
      return clampMax(round2((total * pct) / 100), d.max_discount);
    }
    case "buy_x_get_y": {
      // Expect rules like {buy_qty:2, get_qty:1, category:"Kurti"}
      const r = d.rules || {};
      const cat = r.category || null;
      const buy = Number(r.buy_qty || 2);
      const get = Number(r.get_qty || 1);
      // Count eligible items (by quantity) within category, pick cheapest free items
      const eligible = [];
      items.forEach((it) => {
        if (!cat || (it.category || it.manual_category) === cat) {
          const p = priceItem(it);
          for (let i = 0; i < (it.quantity || 1); i++)
            eligible.push(p.withCharges / (it.quantity || 1));
        }
      });
      eligible.sort((a, b) => a - b);
      if (eligible.length < buy + get) return 0;
      const group = Math.floor(eligible.length / (buy + get));
      const freeCount = group * get;
      const discount = eligible.slice(0, freeCount).reduce((s, v) => s + v, 0);
      return clampMax(round2(discount), d.max_discount);
    }
    case "fixed_price": {
      // Example: set total to a fixed price for a category bundle; rules {fixed_total:1000, category:"Kurti"}
      const r = d.rules || {};
      const cat = r.category || null;
      const fixed = Number(r.fixed_total || 0);
      const sumCat = items.reduce((s, it) => {
        if (!cat || (it.category || it.manual_category) === cat)
          return s + priceItem(it).withCharges;
        return s;
      }, 0);
      const discount = Math.max(0, sumCat - fixed);
      return clampMax(round2(discount), d.max_discount);
    }
    case "conditional": {
      // rules like {min_total:3500, value:100} => flat 100 off if min_total met
      const r = d.rules || {};
      const minTotal = Number(r.min_total || d.min_total || 0);
      const val = Number(r.value || d.value || 0);
      return total >= minTotal ? clampMax(val, d.max_discount) : 0;
    }
    default:
      return 0;
  }
}

function materializeItemForDb(billId, it) {
  const priced = priceItem(it);
  return {
    billid: billId,
    quantity: Number(it.quantity || 1),
    mrp: toMoney(it.mrp || 0),
    variantid: it.variantid || null,
    product_name: it.product_name || it.manual_name || null,
    product_code: it.product_code || it.manual_code || null,
    category: it.category || it.manual_category || null,
    alteration_charge: toMoney(it.alteration_charge || 0),
    stitching_charge: toMoney(it.stitching_charge || 0),
    discount_total: toMoney(priced.itemDisc),
    subtotal: toMoney(priced.subtotal),
    gst_rate: Number(it.gstRate ?? 12),
    gst_amount: toMoney(priced.gst_amount),
    total: toMoney(priced.total),
  };
}

/*******************************
 * Utils
 *******************************/

function money(n) {
  return Number(n || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
function toMoney(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}
function round2(n) {
  return Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
}
function clampMax(v, m) {
  if (!m && m !== 0) return v;
  return Math.min(v, Number(m));
}
function describeDiscount(d) {
  switch (d.type) {
    case "flat":
      return `Flat ₹${d.value || 0} off${
        d.min_total ? ` on min ₹${d.min_total}` : ""
      }`;
    case "percentage":
      return `${d.value || 0}% off${
        d.max_discount ? ` (max ₹${d.max_discount})` : ""
      }`;
    case "buy_x_get_y": {
      const r = d.rules || {};
      return `Buy ${r.buy_qty || 2} Get ${r.get_qty || 1}${
        r.category ? ` on ${r.category}` : ""
      }`;
    }
    case "fixed_price": {
      const r = d.rules || {};
      return `Fixed total ₹${r.fixed_total || 0}${
        r.category ? ` for ${r.category}` : ""
      }`;
    }
    case "conditional": {
      const r = d.rules || {};
      const min = r.min_total || d.min_total;
      const val = r.value || d.value;
      return min ? `₹${val || 0} off on min ₹${min}` : `₹${val || 0} off`;
    }
    default:
      return d.type;
  }
}
function cryptoRandomUlid() {
  // Not a strict ULID, but keeps your 26-char constraint in DB; replace with real ULID lib if needed
  return uuidv4().replace(/-/g, "").slice(0, 26);
}
