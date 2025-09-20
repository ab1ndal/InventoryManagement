// src/admin/components/billing/CustomerSelector.js
import { useState, useEffect } from "react";
import { Input } from "../../../components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "../../../components/ui/select";
import { Button } from "../../../components/ui/button";
import CustomerForm from "../CustomerForm"; // reuse existing form
import { supabase } from "../../../lib/supabaseClient";

export default function CustomerSelector({
  selectedCustomerId,
  setSelectedCustomerId,
}) {
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerOptions, setCustomerOptions] = useState([]);

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
        .or(`phone.ilike.%${q}%,first_name.ilike.%${q}%,last_name.ilike.%${q}%`)
        .limit(15);
      if (!error) setCustomerOptions(data || []);
    };
    const t = setTimeout(run, 300);
    return () => clearTimeout(t);
  }, [customerQuery]);

  return (
    <div className="flex gap-2 items-start">
      <Input
        placeholder="Search by name or phone"
        value={customerQuery}
        onChange={(e) => setCustomerQuery(e.target.value)}
        className="max-w-xs"
      />
      <Select
        onValueChange={(v) => setSelectedCustomerId(Number(v))}
        value={selectedCustomerId ? String(selectedCustomerId) : undefined}
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
      <CustomerForm
        triggerLabel="New Customer"
        onSubmit={(cust) => {
          setSelectedCustomerId(cust.customerid);
          setCustomerQuery("");
        }}
      />
    </div>
  );
}
