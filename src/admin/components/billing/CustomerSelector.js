// src/admin/components/billing/CustomerSelector.js
import { useState, useEffect, useRef } from "react";
import { Input } from "../../../components/ui/input";
import CustomerForm from "../CustomerForm";
import { supabase } from "../../../lib/supabaseClient";
import {
  buildCustomerSearchFilter,
  customerDraftFromSearch,
  CUSTOMER_SEARCH_LIMIT,
} from "./customerSearch";

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
  const [activeIndex, setActiveIndex] = useState(-1);
  const [noMatch, setNoMatch] = useState(false);
  const addCustomerRef = useRef(null);

  // Pre-populate display text when loading an existing bill
  useEffect(() => {
    if (displayName) setCustomerQuery(displayName);
  }, [displayName]);

  useEffect(() => {
    const run = async () => {
      const q = customerQuery.trim();
      // The prefilled name of an opened bill is not a search.
      const filter = buildCustomerSearchFilter(q);
      if (!filter || (selectedCustomerId && customerQuery === displayName)) {
        setCustomerOptions([]);
        setNoMatch(false);
        return;
      }
      const { data, error } = await supabase
        .from("customers")
        .select("customerid, first_name, last_name, phone")
        .or(filter)
        .limit(CUSTOMER_SEARCH_LIMIT);
      if (!error) {
        setCustomerOptions(data || []);
        setActiveIndex(-1);
        setNoMatch((data || []).length === 0);
      }
    };
    const t = setTimeout(run, 300);
    return () => clearTimeout(t);
  }, [customerQuery, displayName, selectedCustomerId]);

  const handleSelect = (cust) => {
    setSelectedCustomerId(cust.customerid);
    setCustomerQuery(customerLabel(cust));
    setShowDropdown(false);
  };

  const handleKeyDown = (e) => {
    if (!showDropdown) return;
    const count = customerOptions.length;
    if (e.key === "ArrowDown" && count > 0) {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % count);
    } else if (e.key === "ArrowUp" && count > 0) {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? count - 1 : i - 1));
    } else if (e.key === "Enter" && activeIndex >= 0 && customerOptions[activeIndex]) {
      e.preventDefault();
      handleSelect(customerOptions[activeIndex]);
    } else if (e.key === "Escape") {
      setShowDropdown(false);
    }
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
            setActiveIndex(-1);
            setNoMatch(false);
            // The text no longer names the selected customer, so the bill must not stay linked to them.
            if (selectedCustomerId) setSelectedCustomerId(null);
          }}
          onKeyDown={handleKeyDown}
        />
        {showDropdown && customerOptions.length > 0 && (
          <div className="absolute z-10 w-full mt-1 bg-white border rounded shadow">
            {customerOptions.map((c, i) => (
              <button
                type="button"
                key={c.customerid}
                className={`block w-full px-3 py-2 text-left hover:bg-gray-100 focus-visible:bg-gray-100 ${i === activeIndex ? "bg-gray-100" : ""}`}
                onClick={() => handleSelect(c)}
              >
                {customerLabel(c)}
              </button>
            ))}
          </div>
        )}
        {showDropdown && noMatch && customerOptions.length === 0 && (
          <div className="absolute z-10 w-full mt-1 bg-white border rounded shadow">
            <button
              type="button"
              className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-100 focus-visible:bg-gray-100"
              onClick={() => {
                setShowDropdown(false);
                addCustomerRef.current?.querySelector("button")?.click();
              }}
            >
              No match. Add this customer
            </button>
          </div>
        )}
      </div>
      <div ref={addCustomerRef}>
      <CustomerForm
        triggerLabel="Add Customer"
        // A selected customer's label is not something to copy into a new one.
        defaultValues={selectedCustomerId ? {} : customerDraftFromSearch(customerQuery)}
        onSubmit={(cust) => {
          setSelectedCustomerId(cust.customerid);
          setCustomerQuery(customerLabel(cust));
          setShowDropdown(false);
        }}
      />
      </div>
    </div>
  );
}
