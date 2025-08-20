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
import { formatLivePhoneInput } from "../../utility/formatPhone";
import { toast } from "sonner";
import { z } from "zod";
import "react-datepicker/dist/react-datepicker.css";
import {
  Dialog,
  DialogTrigger,
  DialogDescription,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import CustomDropdown from "../../components/CustomDropdown";

const formSchema = z.object({
  referred_by: z.coerce.number().optional(),
  first_name: z.string().min(1, "First name is required"),
  last_name: z.string().min(1, "Last name is required"),
  phone: z.string().regex(/^\+\d[\d\s]{9,20}$/, "Must start with country code"),
  email: z.string().email("Invalid email").or(z.literal("")).optional(),
  address: z.string().optional(),
  loyalty_tier: z.string().optional(),
  gender: z.string().optional(),
  store_credit: z.coerce.number().nonnegative().optional(),
  customer_notes: z.string().optional(),
});

export default function CustomerForm(props) {
  const {
    triggerLabel = "Add Customer",
    triggerButton,
    onSubmit,
    defaultValues = {},
  } = props;

  const defaultsSig = React.useMemo(
    () => JSON.stringify(defaultValues),
    [defaultValues]
  );
  const stableDefaults = React.useMemo(
    () => JSON.parse(defaultsSig),
    [defaultsSig]
  );

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
      gender: "",
      store_credit: 0,
      customer_notes: "",
      ...stableDefaults,
    },
  });

  // 2) Build a reset payload and a stable signature
  const baseDefaults = React.useMemo(
    () => ({
      first_name: "",
      last_name: "",
      phone: "+91",
      email: "",
      address: "",
      loyalty_tier: "bronze",
      gender: "",
      store_credit: 0,
      customer_notes: "",
      referred_by: null,
    }),
    []
  );

  const resetPayload = React.useMemo(
    () => ({ ...baseDefaults, ...stableDefaults }),
    [baseDefaults, stableDefaults]
  );

  const lastResetSignatureRef = React.useRef(null);

  React.useEffect(() => {
    if (!open) return;

    const currentSig = JSON.stringify(resetPayload);
    if (lastResetSignatureRef.current !== currentSig) {
      form.reset(resetPayload);
      lastResetSignatureRef.current = currentSig;
    }

    let active = true;
    const fetchCustomers = async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("customerid, first_name, last_name, phone");
      if (!error && active) setCustomers(data || []);
    };
    fetchCustomers();

    return () => {
      active = false;
    };
  }, [open, form, resetPayload]);

  const handleSubmit = async (values) => {
    try {
      const ulid =
        stableDefaults.customer_ulid || uuidv4().replace(/-/g, "").slice(0, 26);

      // Check for duplicate phone numbers only when creating new
      if (!stableDefaults.customer_ulid) {
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
        referred_by: values.referred_by || null,
      };

      const { data, error } = await supabase
        .from("customers")
        .upsert(payload, { onConflict: "customer_ulid" })
        .select();

      if (error) throw error;

      toast.success(
        `Customer ${
          stableDefaults.customer_ulid ? "updated" : "added"
        } successfully`
      );
      setOpen(false);
      onSubmit?.(data[0]);
    } catch (err) {
      toast.error("Error", { description: err.message });
    }
  };

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
            {stableDefaults.customer_ulid ? "Edit Customer" : "Add Customer"}
          </DialogTitle>
          <DialogDescription>
            {stableDefaults.customer_ulid ? "Update" : "Enter"} customer
            details. All fields can be edited later.
          </DialogDescription>
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
                      <Input {...field} placeholder="Enter First Name" />
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
                      <Input {...field} placeholder="Enter Last Name" />
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
                      <Input
                        {...field}
                        placeholder="Enter Email"
                        type="email"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              name="address"
              control={form.control}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Address</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Enter Address" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
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
                control={form.control}
                name="store_credit"
                render={({ field }) => {
                  const toINR = (v) => {
                    const n = Number(v);
                    if (Number.isNaN(n)) return "";
                    return new Intl.NumberFormat("en-IN", {
                      style: "currency",
                      currency: "INR",
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    }).format(n);
                  };

                  const handleChange = (e) => {
                    // keep digits and at most one dot
                    let raw = e.target.value.replace(/[^0-9.]/g, "");
                    const parts = raw.split(".");

                    if (parts.length > 2) {
                      // collapse extra dots into the first decimal part
                      raw =
                        parts[0] +
                        "." +
                        parts.slice(1).join("").replace(/\./g, "");
                    }

                    let [intPart, decPart] = raw.split(".");
                    intPart = intPart ?? "";
                    decPart = decPart ?? undefined;

                    // allow typing "." as the first character by turning it into "0."
                    if (raw === ".") {
                      field.onChange("0.");
                      return;
                    }

                    // if the value ends with a dot, keep it so the user can continue typing decimals
                    if (raw.endsWith(".")) {
                      field.onChange((intPart || "0") + ".");
                      return;
                    }

                    // if there is a decimal part, clamp to two places
                    if (decPart !== undefined) {
                      field.onChange(
                        `${intPart || "0"}.${decPart.slice(0, 2)}`
                      );
                      return;
                    }

                    // integers only
                    field.onChange(intPart);
                  };

                  const handleBlur = () => {
                    const v = String(field.value ?? "").trim();

                    if (v === "" || v === ".") {
                      field.onChange("");
                      return;
                    }

                    // normalize trailing dot like "12." to "12.00"
                    const normalized = v.endsWith(".") ? v.slice(0, -1) : v;
                    const n = parseFloat(normalized);
                    if (!Number.isNaN(n)) {
                      field.onChange(n.toFixed(2));
                    } else {
                      field.onChange("");
                    }
                  };

                  return (
                    <FormItem>
                      <FormLabel>Store Credit</FormLabel>
                      <FormControl>
                        <div className="space-y-1">
                          <Input
                            inputMode="decimal"
                            placeholder="0.00"
                            value={field.value ?? ""}
                            onChange={handleChange}
                            onBlur={handleBlur}
                          />
                          <div className="text-xs text-muted-foreground">
                            {field.value && !String(field.value).endsWith(".")
                              ? toINR(field.value)
                              : ""}
                          </div>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  );
                }}
              />

              <FormField
                control={form.control}
                name="referred_by"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Referred By</FormLabel>
                    <FormControl>
                      <CustomDropdown
                        value={field.value}
                        onChange={(val) =>
                          field.onChange(val === "" ? null : val)
                        }
                        onBlur={field.onBlur}
                        options={[
                          { value: "", label: "None" },
                          ...customers
                            .filter(
                              (c) => c.customerid !== stableDefaults.customerid
                            )
                            .sort((a, b) =>
                              `${a.first_name} ${a.last_name}`.localeCompare(
                                `${b.first_name} ${b.last_name}`
                              )
                            )
                            .map((c) => ({
                              value: c.customerid,
                              label: `${c.first_name} ${c.last_name} | ${c.phone}`,
                            })),
                        ]}
                        placeholder="Select Referrer"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

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
                {stableDefaults.customer_ulid ? "Update" : "Save"} Customer
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
