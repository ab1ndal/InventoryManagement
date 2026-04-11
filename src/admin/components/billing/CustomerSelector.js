// src/admin/components/billing/CustomerSelector.js
import { useState, useEffect } from "react";
import { Input } from "../../../components/ui/input";
import CustomerForm from "../CustomerForm";
import { supabase } from "../../../lib/supabaseClient";

export default function CustomerSelector({
  selectedCustomerId,
  setSelectedCustomerId,
  displayName,
}) {
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerOptions, setCustomerOptions] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);

  // Pre-populate display text when loading an existing bill
  useEffect(() => {
    if (displayName) setCustomerQuery(displayName);
  }, [displayName]);

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
        .limit(4);
      if (!error) setCustomerOptions(data || []);
    };
    const t = setTimeout(run, 300);
    return () => clearTimeout(t);
  }, [customerQuery]);

  const handleSelect = (cust) => {
    setSelectedCustomerId(cust.customerid);
    setCustomerQuery(`${cust.first_name} ${cust.last_name} | ${cust.phone}`);
    setShowDropdown(false);
  };

  return (
    <div className="flex items-start gap-2">
      <div className="relative w-[280px]">
        <Input
          placeholder="Search by name or phone"
          value={customerQuery}
          onChange={(e) => {
            setCustomerQuery(e.target.value);
            setShowDropdown(true);
          }}
        />
        {showDropdown && customerOptions.length > 0 && (
          <div className="absolute z-10 w-full mt-1 bg-white border rounded shadow">
            {customerOptions.map((c) => (
              <div
                key={c.customerid}
                className="px-3 py-2 cursor-pointer hover:bg-gray-100"
                onClick={() => handleSelect(c)}
              >
                {c.first_name} {c.last_name} | {c.phone}
              </div>
            ))}
          </div>
        )}
      </div>
      <CustomerForm
        triggerLabel="Add Customer"
        onSubmit={(cust) => {
          setSelectedCustomerId(cust.customerid);
          setCustomerQuery(
            `${cust.first_name} ${cust.last_name} | ${cust.phone}`
          );
          setShowDropdown(false);
        }}
      />
    </div>
  );
}
