// src/admin/components/CustomerForm.js
import React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { v4 as uuidv4 } from "uuid";
import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";
import { supabase } from "../../lib/supabaseClient";
import {
  Form,
  FormField,
  FormItem,
  FormMessage,
  FormControl,
  FormLabel,
} from "../../components/ui/form";
import { formatDate } from "../../utility/dateFormat"
import { formatLivePhoneInput } from "../../utility/formatPhone"
import { toast } from "sonner";
import { z } from "zod";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import CustomDropdown from "../../components/CustomDropdown";

const formSchema = z.object({
  referred_by: z.coerce.number().optional(),
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  phone: z.string().regex(/^\+\d[\d\s]{9,20}$/, "Must start with country code"),
  email: z.string().email().optional(),
  address: z.string().optional(),
  loyalty_tier: z.string().optional(),
  date_of_birth: z.date().optional(),
  gender: z.string().optional(),
  customer_notes: z.string().optional(),
});

export default function CustomerForm({
  triggerLabel = "Add Customer",
  triggerButton,
  onSubmit,
  defaultValues = {},
}) {
  const [open, setOpen] = React.useState(false);
  const [customers, setCustomers] = React.useState([]);

  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      first_name: "",
      last_name: "",
      phone: "+91",
      email: "",
      address: "",
      loyalty_tier: "bronze",
      date_of_birth: defaultValues.date_of_birth
        ? new Date(defaultValues.date_of_birth + "T00:00:00")
        : null,
      gender: "",
      customer_notes: "",
      ...defaultValues,
    },
  });

  const handleSubmit = async (values) => {
    try {
      const ulid =
        defaultValues.customer_ulid || uuidv4().replace(/-/g, "").slice(0, 26);

      // Check for duplicate phone numbers only when creating new
      if (!defaultValues.customer_ulid) {
        const { data: existing } = await supabase
          .from("customers")
          .select("customerid")
          .eq("phone", values.phone);

        if (existing && existing.length > 0) {
          toast.warning("Phone number already exists");
          return;
        }
      }

      const payload = {
        ...values,
        phone: values.phone.replace(/\s/g, ""),
        customer_ulid: ulid,
        date_of_birth: values.date_of_birth
          ? values.date_of_birth.toISOString().split("T")[0]
          : null,
      };

      const { data, error } = await supabase
        .from("customers")
        .upsert(payload, { onConflict: "customer_ulid" })
        .select();

      if (error) throw error;

      toast.success(
        `Customer ${
          defaultValues.customer_ulid ? "updated" : "added"
        } successfully`
      );
      setOpen(false);
      onSubmit?.(data[0]);
    } catch (err) {
      toast.error("Error", { description: err.message });
    }
  };

  React.useEffect(() => {
    if (!open) return;

    const fetchCustomers = async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("customerid, first_name, last_name, phone");
      if (!error) setCustomers(data || []);
    };
    fetchCustomers();
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {triggerButton ? (
          React.cloneElement(triggerButton, {
            onClick: () => setOpen(true),
          })
        ) : (
          <Button onClick={() => setOpen(true)}>{triggerLabel}</Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-xl bg-white rounded-lg shadow-xl p-6">
        <DialogHeader>
          <DialogTitle>
            {defaultValues.customer_ulid ? "Edit Customer" : "Add Customer"}
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(handleSubmit)}
            className="space-y-4"
          >
            <div className="grid grid-cols-2 gap-4">
              <FormField
                name="first_name"
                control={form.control}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>First Name</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                name="last_name"
                control={form.control}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Last Name</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                name="phone"
                control={form.control}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        onChange={(e) =>
                          field.onChange(formatLivePhoneInput(e.target.value))
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                name="email"
                control={form.control}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input {...field} type="email" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                name="address"
                control={form.control}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Address</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                name="loyalty_tier"
                control={form.control}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Loyalty Tier</FormLabel>
                    <FormControl>
                      <select
                        {...field}
                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      >
                        <option value="bronze">Bronze</option>
                        <option value="silver">Silver</option>
                        <option value="gold">Gold</option>
                        <option value="platinum">Platinum</option>
                      </select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                name="date_of_birth"
                control={form.control}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date of Birth</FormLabel>
                    <FormControl>
                      <div className="mt-1">
                        <DatePicker
                          selected={field.value}
                          onChange={(date) => field.onChange(date)}
                          dateFormat="dd/MM/yyyy"
                          showYearDropdown
                          showMonthDropdown
                          dropdownMode="select"
                          minDate={new Date("1950-01-01")}
                          maxDate={new Date()}
                          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                name="gender"
                control={form.control}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Gender</FormLabel>
                    <FormControl>
                      <select
                        {...field}
                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      >
                        <option value="">Select</option>
                        <option value="Male">Male</option>
                        <option value="Female">Female</option>
                        <option value="Other">Other</option>
                        <option value="Prefer not to say">
                          Prefer not to say
                        </option>
                        <option value="Unknown">Unknown</option>
                      </select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="referred_by"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Referred By</FormLabel>
                  <FormControl>
                    <CustomDropdown
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      options={customers
                        .filter(
                          (c) => c.customerid !== defaultValues.customerid
                        )
                        .sort((a, b) =>
                          `${a.first_name} ${a.last_name}`.localeCompare(
                            `${b.first_name} ${b.last_name}`
                          )
                        )
                        .map((c) => ({
                          value: c.customerid,
                          label: `${c.first_name} ${c.last_name} | ${c.phone}`,
                        }))}
                      placeholder="Select Referrer"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              name="customer_notes"
              control={form.control}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Customer Notes</FormLabel>
                  <FormControl>
                    <textarea
                      {...field}
                      rows={4}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      placeholder="Enter any notes about the customer..."
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="px-6 py-2 rounded-md text-sm font-medium">
              <Button type="submit">
                {defaultValues.customer_ulid ? "Update" : "Save"} Customer
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
