// src/admin/components/billing/CustomerSelector.js
import { useState, useEffect } from "react";
import { Input } from "../../../components/ui/input";
import CustomerForm from "../CustomerForm";
import { supabase } from "../../../lib/supabaseClient";

const customerLabel = (c) =>
  `${`${c.first_name} ${c.last_name || ""}`.trim()} | ${c.phone || "No Phone"}`;

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
      // The prefilled name of an opened bill is not a search.
      if (!q || (selectedCustomerId && customerQuery === displayName)) {
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
  }, [customerQuery, displayName, selectedCustomerId]);

  const handleSelect = (cust) => {
    setSelectedCustomerId(cust.customerid);
    setCustomerQuery(customerLabel(cust));
    setShowDropdown(false);
  };

  return (
    <div className="flex flex-wrap items-start gap-2">
      <div className="relative w-full max-w-[280px]">
        <Input
          id="bill-customer"
          placeholder="Search by name or phone"
          value={customerQuery}
          onChange={(e) => {
            setCustomerQuery(e.target.value);
            setShowDropdown(true);
            // The text no longer names the selected customer, so the bill must not stay linked to them.
            if (selectedCustomerId) setSelectedCustomerId(null);
          }}
        />
        {showDropdown && customerOptions.length > 0 && (
          <div className="absolute z-10 w-full mt-1 bg-white border rounded shadow">
            {customerOptions.map((c) => (
              <button
                type="button"
                key={c.customerid}
                className="block w-full px-3 py-2 text-left hover:bg-gray-100 focus-visible:bg-gray-100"
                onClick={() => handleSelect(c)}
              >
                {customerLabel(c)}
              </button>
            ))}
          </div>
        )}
      </div>
      <CustomerForm
        triggerLabel="Add Customer"
        onSubmit={(cust) => {
          setSelectedCustomerId(cust.customerid);
          setCustomerQuery(customerLabel(cust));
          setShowDropdown(false);
        }}
      />
    </div>
  );
}
