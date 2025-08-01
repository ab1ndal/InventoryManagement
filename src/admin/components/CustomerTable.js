// src/admin/components/CustomerTable.js
import React, { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";
import CustomerForm from "./CustomerForm";
import { Badge } from "../../components/ui/badge";
import { parsePhoneNumber } from "libphonenumber-js";
import { Pencil, Trash2 } from "lucide-react"
import {formatDate} from "../../utility/dateFormat"
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "../../components/ui/tooltip";
import { toast } from "sonner";

function getBadgeClass(tier) {
  switch (tier) {
    case "Bronze":
      return "bg-amber-300 text-black";
    case "Silver":
      return "bg-gray-300 text-black";
    case "Gold":
      return "bg-yellow-400 text-black";
    case "Platinum":
      return "bg-blue-300 text-black";
    default:
      return "border border-gray-300 text-gray-600";
  }
}

export default function CustomerTable({ onEditCustomer, refreshSignal }) {
  const [customers, setCustomers] = useState([]);
  const [filters, setFilters] = useState({
    first_name: "",
    last_name: "",
    phone: "",
    referred_by: "",
    email: "",
    loyalty_tier: "",
  });

  const [editCustomer, setEditCustomer] = useState(null);
  const [page, setPage] = useState(1);
  const rowsPerPage = 15;

  useEffect(() => {
    fetchCustomers();
  }, [refreshSignal]);

  const fetchCustomers = async () => {
    const { data, error } = await supabase
      .from("customers")
      .select("*, referred_by_data:referred_by(first_name, last_name)")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching customers:", error.message);
    } else {
      setCustomers(data || []);
    }
  };

  const handleDelete = async (customer_ulid) => {
    const confirm = window.confirm(
      "Are you sure you want to delete this customer?"
    );
    if (!confirm) return;

    const { error } = await supabase
      .from("customers")
      .delete()
      .eq("customer_ulid", customer_ulid);

    if (error) {
      toast.error("Error deleting customer", { description: error.message });
    } else {
      fetchCustomers(); // Refresh table
      toast.success("Customer deleted successfully");
    }
  };
  function formatPhoneNumber(phone) {
    try {
      const number = parsePhoneNumber(phone);
      return number.formatInternational();
    } catch (error) {
      return phone;
    }
  }

  const filteredCustomers = customers.filter((c) => {
    const referredName = c.referred_by_data
      ? `${c.referred_by_data.first_name} ${c.referred_by_data.last_name}`
      : "";
    return (
      c.first_name
        ?.toLowerCase()
        .includes(filters.first_name?.toLowerCase() || "") &&
      c.last_name
        ?.toLowerCase()
        .includes(filters.last_name?.toLowerCase() || "") &&
      c.phone?.includes(filters.phone || "") &&
      c.email?.toLowerCase().includes(filters.email?.toLowerCase() || "") &&
      c.loyalty_tier
        ?.toLowerCase()
        .includes(filters.loyalty_tier?.toLowerCase() || "") &&
      referredName
        .toLowerCase()
        .includes((filters.referred_by || "").toLowerCase().trim())
    );
  });

  const paginatedCustomers = filteredCustomers.slice(
    (page - 1) * rowsPerPage,
    page * rowsPerPage
  );

  return (
    <TooltipProvider>
      <div className="overflow-auto border rounded-md">
        <div className="flex justify-between items-center px-4 py-2 bg-gray-50 border-b">
          <h3 className="text-lg font-semibold text-gray-700">Customers</h3>
          <CustomerForm
            triggerLabel="Add Customer"
            onSubmit={() => fetchCustomers()}
          />
        </div>

        <table className="min-w-full text-sm text-left table-fixed">
          <thead className="bg-gray-100">
            <tr>
              <th className="p-2 text-center w-[140px]">First Name</th>
              <th className="p-2 text-center w-[140px]">Last Name</th>
              <th className="p-2 text-center w-[180px]">Phone</th>
              <th className="p-2 text-center w-[180px]">Referred By</th>
              <th className="p-2 text-center w-[200px]">Email</th>
              <th className="p-2 text-center w-[50px]">Loyalty</th>
              <th className="p-2 text-center w-[50px]">Total Spend</th>
              <th className="p-2 text-center w-[50px]">Last Purchase</th>
              <th className="p-2 text-center w-[50px]">Actions</th>
            </tr>
            <tr className="bg-white text-xs text-gray-400 text-center border-t">
              {[
                "first_name",
                "last_name",
                "phone",
                "referred_by",
                "email",
                "loyalty_tier",
                "",
                "",
                "",
              ].map((key, idx) => (
                <th key={idx} className="p-1 text-center">
                  {key ? (
                    <Input
                      type="text"
                      placeholder="Filter"
                      value={filters[key]}
                      onChange={(e) =>
                        setFilters((prev) => ({
                          ...prev,
                          [key]: e.target.value,
                        }))
                      }
                      className="w-full h-6 px-2 py-1 rounded-md text-center bg-gray-50 border border-gray-200 text-gray-600 placeholder:text-gray-300 focus:ring-1 focus:ring-primary"
                    />
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredCustomers.length === 0 ? (
              <tr className="border-t">
                <td
                  colSpan={10}
                  className="p-2 text-center w-[140px] py-4 text-gray-500"
                >
                  No customers found
                </td>
              </tr>
            ) : (
              paginatedCustomers.map((customer) => (
                <tr key={customer.customer_ulid} className="border-t">
                  <td className="p-2 text-center w-[140px]">
                    {customer.first_name}
                  </td>
                  <td className="p-2 text-center w-[140px]">
                    {customer.last_name}
                  </td>
                  <td className="p-2 text-center w-[180px]">
                    {formatPhoneNumber(customer.phone)}
                  </td>
                  <td className="p-2 text-center w-[180px]">
                    {customer.referred_by_data
                      ? `${customer.referred_by_data.first_name} ${customer.referred_by_data.last_name}`
                      : "-"}
                  </td>
                  <td className="p-2 text-center w-[200px] overflow-hidden text-ellipsis whitespace-nowrap">
                    {customer.email}
                  </td>

                  <td className="p-2 text-center w-[50px]">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge
                          variant="outline"
                          className={`
                          ${
                            customer.loyalty_tier === "bronze"
                              ? "bg-orange-400 text-black border-none"
                              : customer.loyalty_tier === "silver"
                              ? "bg-zinc-300 text-black border-none"
                              : customer.loyalty_tier === "gold"
                              ? "bg-yellow-400 text-black border-none"
                              : customer.loyalty_tier === "platinum"
                              ? "bg-indigo-200 text-black border-none"
                              : "bg-gray-100 text-gray-600"
                          }
                        `}
                        >
                          {customer.loyalty_tier || "-"}
                        </Badge>
                      </TooltipTrigger>
                      {customer.customer_notes && (
                        <TooltipContent className="max-w-xs whitespace-pre-wrap bg-white text-black shadow-md border border-gray-200 p-2 rounded-md">
                          {customer.customer_notes}
                        </TooltipContent>
                      )}
                    </Tooltip>
                  </td>
                  <td className="p-2 text-left w-[50px]">
                    ₹{(customer.total_spend || 0).toFixed(2)}
                  </td>
                  <td className="p-2 text-center w-[50px]">
                    {customer.last_purchased_at
                      ? formatDate(customer.last_purchased_at)
                      : "-"}
                  </td>
                  <td className="p-2 text-center w-[50px] flex justify-center gap-2">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <CustomerForm
                          triggerButton={
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-yellow-600 hover:bg-yellow-100"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          }
                          defaultValues={customer}
                          onSubmit={() => fetchCustomers()}
                        />
                      </TooltipTrigger>
                      <TooltipContent>Edit</TooltipContent>
                    </Tooltip>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-red-600 hover:bg-red-100"
                          onClick={() => handleDelete(customer.customer_ulid)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Delete</TooltipContent>
                    </Tooltip>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="flex justify-center items-center gap-4 py-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(p - 1, 1))}
            disabled={page === 1}
          >
            Previous
          </Button>
          <span className="text-sm text-gray-600">Page {page}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setPage((p) =>
                p * rowsPerPage >= filteredCustomers.length ? p : p + 1
              )
            }
            disabled={page * rowsPerPage >= filteredCustomers.length}
          >
            Next
          </Button>
        </div>
      </div>
    </TooltipProvider>
  );
}
