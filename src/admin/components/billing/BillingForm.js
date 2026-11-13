import { useState, useMemo, useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { computeBillTotals, computeBalanceAdjustedTotals, priceItem, computeAlterationDeposit } from "./billUtils";
import { buildBillItemsPayload, computeStockDelta, describeStockShortfalls, backCalcDiscountPct, exchangedLineProblems, linesWithSavedIds } from "./stockHelpers";
import { isWebsiteMethod, paymentStatusAfterEdit, editExcess, excessCountsExchangeTwice } from "./paymentHelpers";
import { computeCreditsApplied, computeExchangeBalance } from "./exchangeHelpers";
import { BILL_STATUS, billStatusFields } from "../../lib/billStatus";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "../../../components/ui/select";
import {
  Card,
  CardContent,
} from "../../../components/ui/card";
import { Label } from "../../../components/ui/label";
//import { Textarea } from "../../../components/ui/textarea";
import { supabase } from "../../../lib/supabaseClient";
import { toast } from "sonner";
import { logActivity } from "../../../lib/activityLog";
import { money } from "../../../utility/activitySummary";
import { formatDate, todayIST } from "../../../utility/dateFormat";
import { money as billMoney } from "./billUtils";

import CustomerSelector from "./CustomerSelector";
import ItemTable from "./ItemTable";
import AddItemDialog from "./AddItemDialog";
import DiscountSelector from "./DiscountSelector";
import Summary from "./Summary";
import Notes from "./Notes";
import BillSlipPhotos from "./BillSlipPhotos";
import SalespersonSelector from "./SalespersonSelector";
import InvoiceView from "./InvoiceView";
import PaymentHistory from "./PaymentHistory";
import { generateInvoicePdf } from "./generateInvoicePdf";
import {
  DISCOUNT_COLUMNS,
  loadActiveDiscounts,
  loadActiveSalespeople,
  loadCategories,
  loadSalesLocations,
  loadSalesMethods,
} from "./billingLookups";
import {
  Dialog,
  //  DialogTrigger,
  DialogDescription,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";

// bill_add_payment refusals, in words staff can act on.
const ADD_PAYMENT_ERRORS = {
  BILL_NOT_PAYABLE: "This bill is a draft or has been cancelled, so it cannot take a payment. Refresh the bill list.",
  BILL_ONLINE: "This is a website order's bill. Its payments are handled from Online Orders.",
  BILL_KEY_CONFLICT: "A payment from this screen may already be recorded. Reopen the bill to check before recording again.",
  BILL_OVERPAID: "This is more than the balance due. Check the amount, and reopen the bill in case it was paid in another window.",
  BILL_NOTHING_DUE: "Nothing is left to pay on this bill. Reopen it in case it was paid in another window.",
};

// Shown when an opened bill was paid, finalized or cancelled in another window since it loaded.
const BILL_CHANGED_MESSAGE = "This bill changed in another window — reload";

const EXCHANGED_LINE_MESSAGE =
  "An exchanged item must stay on the bill with at least the exchanged quantity. Reopen the bill.";

// bill_save refusals, in words staff can act on. A refused save changed nothing.
const BILL_SAVE_ERRORS = {
  BILL_EXCHANGE_USED: "This exchange credit has already been used on another bill. Nothing was saved. Close this window and start the bill again.",
  BILL_EXCHANGE_CUSTOMER: "This exchange credit belongs to another customer. Nothing was saved. Choose the customer who returned the items.",
  BILL_EXCHANGE_OVER: "The exchange credit on this bill is more than the exchange gave. Nothing was saved. Close this window and start the bill again.",
  BILL_KEY_CONFLICT: "A bill from this window may already be saved. Close this window and check the bill list before entering it again.",
  BILL_STALE: BILL_CHANGED_MESSAGE,
  BILL_ITEM_EXCHANGED: EXCHANGED_LINE_MESSAGE,
  BILL_OVERPAID: "The amount received is more than the bill's total. Nothing was saved. Check the amount.",
};

// BILL_CREDIT_SHORT: the customer's store credit was spent elsewhere (another window, another bill)
// since this screen loaded it. bill_save's detail is {balance, requested}.
const creditShortMessage = (details) => {
  const { balance } = JSON.parse(details || "{}");
  const now = balance == null ? "" : ` is now ₹${Number(balance).toFixed(2)}`;
  return `This customer's store credit${now}, less than this bill uses (it was used on another bill). Nothing was saved. Remove the customer and choose them again to load the new balance.`;
};

const EXCESS_USE_SAVE_CHANGES =
  "The customer has paid more than this bill now comes to. Use Save Changes to give the difference back as store credit or a refund.";

// bill_edit refusals, in words staff can act on. A refused bill_edit changed nothing: it saves the
// lines, stock and salespeople in the same transaction as the bill row.
const BILL_EDIT_ERRORS = {
  BILL_STALE: BILL_CHANGED_MESSAGE,
  BILL_PAYMENTS_MISMATCH: BILL_CHANGED_MESSAGE,
  BILL_EXCESS_UNSETTLED: BILL_CHANGED_MESSAGE,
  BILL_EXCESS_CHANGED: BILL_CHANGED_MESSAGE,
  BILL_EXCESS_NEEDS_CUSTOMER: "Store credit needs a customer. Add the customer to the bill, or choose a cash refund.",
  BILL_ONLINE: "This is a website order's bill. Its refunds are handled from Online Orders.",
  BILL_KEY_CONFLICT: "This edit may already be saved. Reopen the bill to check before saving again.",
  BILL_EXCHANGE_COUNTED: "Part of this bill was already given back as exchange credit, so the new total cannot be paid back below it.",
  BILL_ITEM_EXCHANGED: EXCHANGED_LINE_MESSAGE,
  BILL_CREDIT_CUSTOMER: "This bill was paid partly with the customer's store credit, so the customer cannot be changed. Put the customer back, or cancel the bill and make a new one.",
};

// Finalize on an opened finalized bill goes through bill_edit too; these refusals are its own.
const REFINALIZE_ERRORS = {
  BILL_EXCESS_UNSETTLED: EXCESS_USE_SAVE_CHANGES,
  BILL_RECEIVED_CHANGED: "The amount received cannot be lowered here. To give money back, take the items off and use Save Changes.",
  BILL_OVERPAID: "The amount received is more than the bill's total. Check the amount.",
};

// A payment entered today keeps the database's own time. recorded_at has no time zone, so an earlier
// date is stored as midday, well clear of the day boundary.
export const paymentDateFields = (date) =>
  date === todayIST() ? {} : { recorded_at: `${date}T12:00:00` };

// Each change is atomic and independent, so they run together. Returns the variants that failed.
async function applyStockChanges(changes, reason, ref) {
  const results = await Promise.all(
    changes.map(async ([variantId, delta]) => {
      const { error } = await adjustStock(variantId, delta, reason, ref);
      if (error) console.error("Stock update failed for", variantId, error);
      return error ? variantId : null;
    }),
  );
  return results.filter(Boolean);
}

// Everything the form needs about a customer, in one request.
const CUSTOMER_SELECT =
  "first_name, last_name, phone, store_credit, discount_usage(code, billid), " +
  "exchanges(exchangeid, credit_amount, quantity, product_name, bill_items(product_name, bills(bill_number)))";

// Everything the form needs about a bill, in one request, so opening one costs one round trip.
const BILL_SELECT =
  "orderdate, customerid, notes, payment_amount, final_amount, saleslocationid, salesmethodid, bill_number, " +
  "finalized, pdf_url, paymentstatus, stock_reduced, net_amount, totalamount, store_credit_used, exchange_credit_used, exchange_source_bill, " +
  `document_type, applied_codes, customers(${CUSTOMER_SELECT}), ` +
  "bill_payments(payment_id, amount, kind, salesmethodid, recorded_at, notes, salesmethods(methodname)), " +
  "bill_items(*, productsizecolors(size, color), exchanges(quantity, credit_amount)), " +
  "bill_salespersons(salesperson_id, salespersons(name)), " +
  "linked_exchanges:exchanges(exchangeid, credit_amount, quantity, product_name, bill_items(product_name))";

function pendingExchangeCredit(exchanges) {
  if (!exchanges?.length) return null;
  const total = exchanges.reduce((s, e) => s + Number(e.credit_amount || 0), 0);
  const bills = [...new Set(exchanges.map((e) => e.bill_items?.bills?.bill_number).filter(Boolean))];
  return {
    amount: total,
    exchangeIds: exchanges.map((e) => e.exchangeid),
    label: `Exchange Credit${bills.length ? ` — Bill${bills.length > 1 ? "s" : ""} #${bills.join(", #")}` : ""}`,
    items: exchanges.map((e) => ({
      product_name: e.bill_items?.product_name || e.product_name || "Unknown",
      returnQty: Number(e.quantity || 0),
      creditAmount: Number(e.credit_amount || 0),
    })),
  };
}

// Online orders change productsizecolors.stock, customers.store_credit and vouchers
// concurrently with this screen, so each of those writes is one atomic DB call
// (stock = stock + delta in SQL) rather than read-then-write-back, which would
// overwrite an online change made between the read and the write.
const adjustStock = (variantId, delta, reason, ref) =>
  supabase.rpc("stock_adjust", {
    p_variant: variantId,
    p_delta: delta,
    p_reason: reason,
    p_ref: String(ref),
  });

function isAutoApplyEligible(d, items, today) {
  // Date guards (defensive — loadDiscounts already filters, but belt-and-suspenders)
  if (d.start_date && d.start_date > today) return false;
  if (d.end_date && d.end_date < today) return false;
  // min_total guard
  const total = items.reduce((s, it) => s + priceItem(it).withCharges, 0);
  if (Number(d.min_total || 0) > 0 && total < Number(d.min_total)) return false;
  // buy_x_get_y / bundled_pricing: need enough qualifying items
  if (d.type === 'buy_x_get_y' || d.type === 'bundled_pricing') {
    const r = d.rules || {};
    // Support multi-category (rules.categories[]) and single-category fallback
    const cats = r.categories && r.categories.length > 0 ? r.categories : null;
    const singleCat = cats ? null : (r.category || d.category || null);
    const buy = d.type === 'buy_x_get_y' ? Number(r.buy_qty || 2) + Number(r.get_qty || 1) : Number(r.bundle_qty || 1);
    const qtyInCat = items.reduce((s, it) => {
      const itemCat = it.category || it.manual_category || null;
      const matches = cats ? cats.includes(itemCat) : (!singleCat || itemCat === singleCat);
      return matches ? s + Number(it.quantity || 1) : s;
    }, 0);
    if (qtyInCat < buy) return false;
  }
  return true;
}

export default function BillingForm({ billId, open, onOpenChange, onSubmit, exchangeCredit: exchangeCreditProp = null, prefilledCustomerId = null }) {
  const [items, setItems] = useState([]);
  const [docType, setDocType] = useState('bos'); // 'bos' (default) | 'invoice'
  const [isFinalizedBill, setIsFinalizedBill] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState(null);
  const [notes, setNotes] = useState("");
  const [allDiscounts, setAllDiscounts] = useState([]);
  const [selectedCodes, setSelectedCodes] = useState([]);
  const [usedCodeSet, setUsedCodeSet] = useState(new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [selectedSalespersonIds, setSelectedSalespersonIds] = useState([]);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [blockingError, setBlockingError] = useState(null);
  // A new bill whose insert succeeded but whose later steps failed and left it in place.
  // Another click would insert a second bill and move stock again, so the form locks.
  const newBillRef = useRef(null); // { id, number }
  const [unfinishedBill, setUnfinishedBill] = useState(null); // { number, step }
  const [discountWarningAcked, setDiscountWarningAcked] = useState(false);
  const invoiceRef = useRef(null);
  const [customerName, setCustomerName] = useState("");
  const [customerDisplayText, setCustomerDisplayText] = useState("");
  // Names from the opened bill: it may list someone no longer in the active salespeople list.
  const [billSalespersonNames, setBillSalespersonNames] = useState({});
  const [billLoaded, setBillLoaded] = useState(false);
  const [discountStatus, setDiscountStatus] = useState("loading"); // 'loading'|'ready'|'failed'
  const [discountAttempt, setDiscountAttempt] = useState(0);
  const [loadedCustomerId, setLoadedCustomerId] = useState(null);
  const [loadedBillDate, setLoadedBillDate] = useState(null);
  const [discountsOpen, setDiscountsOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [addPaymentDate, setAddPaymentDate] = useState(() => todayIST());
  const [firstPaymentDate, setFirstPaymentDate] = useState("");
  const cleanSnapshotRef = useRef(null);
  const cleanPricingRef = useRef(null);
  // Set when the bill's own response already carried this customer, so no second fetch is needed.
  const preloadedCustomerRef = useRef(null);
  const [effectiveBillId, setEffectiveBillId] = useState(null);
  const [effectiveBillNumber, setEffectiveBillNumber] = useState(null);
  const [isBackdated, setIsBackdated] = useState(false);
  // "Don't reduce stock" is fixed when a bill is first saved: the server refuses a change after that,
  // since a bill that switched it between saves could give back stock it never took.
  const [stockChoiceLocked, setStockChoiceLocked] = useState(false);
  // An existing bill starts blank, not today: today's date looks real, and saving
  // before the bill loads would overwrite the saved date with it.
  const [backdatedDate, setBackdatedDate] = useState(
    () => (billId ? "" : todayIST()),
  );
  const [appliedStoreCredit, setAppliedStoreCredit] = useState(0);
  const [exchangeCredit, setExchangeCredit] = useState(null); // { amount: number, label: string, exchangeIds: number[] }
  const [exchangeBalanceMode, setExchangeBalanceMode] = useState(null); // "store_credit" | "cash_refund" | null
  const [exchangeBalanceAcknowledged, setExchangeBalanceAcknowledged] = useState(false);
  const [availableExchangeCredit, setAvailableExchangeCredit] = useState(null); // { amount, exchangeIds } pending in DB
  const [customerStoreCreditBalance, setCustomerStoreCreditBalance] =
    useState(0);
  const [voucherCode, setVoucherCode] = useState("");
  const [appliedVoucher, setAppliedVoucher] = useState(null); // { voucher_id, value }
  const [billPaymentStatus, setBillPaymentStatus] = useState("draft"); // 'draft'|'partial'|'finalized'|'cancelled'
  const [billPayments, setBillPayments] = useState([]);               // payment records for partial bills
  const [addPaymentAmount, setAddPaymentAmount] = useState("");
  const [addPaymentMethodId, setAddPaymentMethodId] = useState(null);
  const [isAddingPayment, setIsAddingPayment] = useState(false);
  const addPaymentKeyRef = useRef(null); // { attempt, key } for bill_add_payment
  // One key per window for saving a new bill (bill_save) or a draft's first payment. A failed
  // save releases its key, so a corrected retry still saves; a save whose answer was lost is
  // replayed, never saved twice.
  const saveKeyRef = useRef(null);
  // The opened bill's payment state as this window last saw it: { paymentstatus, payment_amount }.
  const openedStateRef = useRef(null);
  // An edit that leaves the shop holding more than the new net waits here for staff to choose
  // a refund or store credit: { amount }.
  const [excessPrompt, setExcessPrompt] = useState(null);
  const [excessMode, setExcessMode] = useState(null); // "store_credit" | "refund" | null
  const [excessMethodId, setExcessMethodId] = useState(null);
  // { key, body } for bill_edit: a retry of the same edit replays instead of settling twice.
  const editKeyRef = useRef(null);
  // _id of every line bill_items holds for the opened bill (see linesForSavedBill).
  const savedItemIdsRef = useRef(new Set());
  // Lines exchange credit was given for: { [_id]: { qty, savedQty, name } }. They stay on the bill.
  const [exchangedById, setExchangedById] = useState({});
  // Exchange credit already given from this bill's lines, as bill_cancel counts it.
  const [exchangeCreditGiven, setExchangeCreditGiven] = useState(0);
  const [partialConfirmOpen, setPartialConfirmOpen] = useState(false);
  const [finalAmount, setFinalAmount] = useState("");
  const [voucherError, setVoucherError] = useState("");
  const [voucherLoading, setVoucherLoading] = useState(false);
  const [salesLocations, setSalesLocations] = useState([]);
  const [salesMethods, setSalesMethods] = useState([]);
  const [salesLocationId, setSalesLocationId] = useState(null);
  const [salesMethodId, setSalesMethodId] = useState(null);
  const [salespersonsList, setSalespersonsList] = useState([]);
  const [categoryMap, setCategoryMap] = useState({});
  const [loadedNetAmount, setLoadedNetAmount] = useState(null); // net_amount from DB for loaded bills

  // Document type is immutable once the bill row exists: the bill number
  // series (BoS vs invoice) is assigned by a DB trigger on first insert and
  // never reassigned. Lock the toggle so an in-session edit can't silently
  // desync document_type/bill_number from the (now re-typed) totals.
  const docTypeLocked = Boolean(billId || effectiveBillId);

  // Reset all form state when the dialog closes. Must NOT include `items` in
  // its dependency array — doing so would cause setItems([]) to create a new
  // array reference on every render, triggering the effect again infinitely.
  useEffect(() => {
    if (!open) {
      setItems([]);
      setSelectedCodes([]);
      setSelectedCustomerId(null);
      setNotes("");
      setAllDiscounts([]);
      setIsSaving(false);
      setEditingItem(null);
      setIsFinalizedBill(false);
      setSelectedSalespersonIds([]);
      setPaymentAmount("");
      setCustomerDisplayText("");
      setEffectiveBillId(null);
      setAppliedStoreCredit(0);
      setExchangeCredit(null);
      setExchangeBalanceMode(null);
      setExchangeBalanceAcknowledged(false);
      setIsBackdated(false);
      setStockChoiceLocked(false);
      setCustomerStoreCreditBalance(0);
      setVoucherCode("");
      setAppliedVoucher(null);
      setVoucherError("");
      setVoucherLoading(false);
      setSalesLocationId(null);
      setSalesMethodId(null);
      setBackdatedDate(billId ? "" : todayIST());
      setBillSalespersonNames({});
      setBillLoaded(false);
      setDiscountStatus("loading");
      setDiscountsOpen(false);
      setDiscardOpen(false);
      setAddPaymentDate(todayIST());
      preloadedCustomerRef.current = null;
      setBillPaymentStatus("draft");
      setBillPayments([]);
      savedItemIdsRef.current = new Set();
      setExchangedById({});
      setExchangeCreditGiven(0);
      setAddPaymentAmount("");
      setAddPaymentMethodId(null);
      setIsAddingPayment(false);
      setPartialConfirmOpen(false);
      setConfirmOpen(false);
      setLoadedBillDate(null);
      setFinalAmount("");
      setLoadedNetAmount(null);
      newBillRef.current = null;
      saveKeyRef.current = null;
      openedStateRef.current = null;
      editKeyRef.current = null;
      setExcessPrompt(null);
      setUnfinishedBill(null);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync exchangeCreditProp into state when dialog opens
  useEffect(() => {
    if (open && exchangeCreditProp) {
      setExchangeCredit(exchangeCreditProp);
    }
  }, [open, exchangeCreditProp]);

  // Auto-select prefilled customer for new bills
  useEffect(() => {
    if (open && !billId && prefilledCustomerId) {
      setSelectedCustomerId(prefilledCustomerId);
    }
  }, [open, billId, prefilledCustomerId]);

  // Discounts are rarely used and matter least on open, so an existing bill fetches them only
  // after everything else has arrived. Saving waits for them when totals depend on them.
  useEffect(() => {
    if (!open || (billId && !billLoaded)) return;
    let superseded = false;
    const load = async () => {
      setDiscountStatus("loading");
      const { data, error } = await loadActiveDiscounts().catch((err) => ({ data: null, error: err }));
      const today = todayIST();
      const usable = (data || []).filter((d) => {
        if (d.start_date && d.start_date > today) return false;
        if (d.end_date && d.end_date < today) return false;
        return true;
      });

      // A bill keeps the discounts it was saved with, even if one has since ended or been switched
      // off. Without its terms the total would silently go up on the next save.
      const savedElsewhere = billId
        ? selectedCodes.filter((code) => !usable.some((d) => d.code === code))
        : [];
      let savedDiscounts = [];
      let savedError = null;
      if (!error && savedElsewhere.length > 0) {
        const saved = await Promise.resolve(
          supabase.from("discounts").select(DISCOUNT_COLUMNS).in("code", savedElsewhere),
        ).catch((err) => ({ data: null, error: err }));
        savedDiscounts = (saved.data || []).map((d) => ({ ...d, savedOnBillOnly: true }));
        savedError = saved.error;
      }
      if (superseded) return;

      const failure = error || savedError;
      if (failure) {
        console.error("Error loading discounts:", failure.message);
        toast.error("Could not load discounts", { description: failure.message });
        setDiscountStatus("failed");
        return;
      }
      if (savedDiscounts.length < savedElsewhere.length) {
        toast.warning("A discount on this bill no longer exists", {
          description: "Its amount is not in the total shown. Check the total before saving.",
        });
      }
      setAllDiscounts([...usable, ...savedDiscounts]);
      setDiscountStatus("ready");
    };
    load();
    return () => {
      superseded = true;
    };
  }, [open, billId, billLoaded, discountAttempt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Only auto-apply on new bills — edits load codes from saved applied_codes
  useEffect(() => {
    if (!open || billId || discountStatus !== "ready") return;
    const today = todayIST();
    setSelectedCodes(
      allDiscounts
        .filter((d) => d.auto_apply && isAutoApplyEligible(d, items, today))
        .map((d) => d.code),
    );
  }, [open, billId, discountStatus, allDiscounts, items]);

  useEffect(() => {
    if (!open) return;
    const loadLookups = async () => {
      const [{ data: locs }, { data: methods }, { data: sps }, { data: categories }] =
        await Promise.all([
          loadSalesLocations(),
          loadSalesMethods(),
          loadActiveSalespeople(),
          loadCategories(),
        ]);
      if (categories) {
        setCategoryMap(Object.fromEntries(categories.map((c) => [c.categoryid, c.name])));
      }
      if (locs) {
        setSalesLocations(locs);
        if (!billId) {
          const walkIn = locs.find((l) => l.locationname === "Walk-In");
          if (walkIn) setSalesLocationId((prev) => prev ?? walkIn.saleslocationid);
        }
      }
      if (methods) setSalesMethods(methods);
      if (sps) setSalespersonsList(sps);
    };
    loadLookups();
  }, [open, billId]);

  useEffect(() => {
    if (!open || !billId) return undefined;
    // Closing or switching bills abandons this load, so a late reply cannot refill the form.
    let superseded = false;
    const loadBill = async () => {
      try {
        const { data: bill, error: billErr } = await supabase
          .from("bills")
          .select(BILL_SELECT)
          .eq("billid", billId)
          .is("customers.exchanges.new_billid", null)
          .order("recorded_at", { ascending: true, referencedTable: "bill_payments" })
          .order("bill_item_id", { ascending: true, referencedTable: "bill_items" })
          .single();
        if (superseded) return;
        if (billErr) throw billErr;
        const savedBillDate = bill.orderdate ? bill.orderdate.slice(0, 10) : todayIST();
        setBackdatedDate(savedBillDate);
        setLoadedBillDate(savedBillDate);
        setEffectiveBillNumber(bill.bill_number || null);
        setDocType(bill.document_type || 'bos');
        setIsFinalizedBill(!!bill.finalized);
        setIsBackdated(bill.stock_reduced === false);
        setStockChoiceLocked(true);
        setBillPaymentStatus(bill.paymentstatus || "draft");
        openedStateRef.current = { paymentstatus: bill.paymentstatus, payment_amount: bill.payment_amount };
        if (bill.net_amount != null) {
          setLoadedNetAmount(Number(bill.net_amount));
        }

        // Fetch installment history regardless of current paymentstatus — a bill that
        // started "partial" flips to "finalized" once fully paid (handleAddPayment), but
        // its bill_payments rows still exist and must stay visible on reopen.
        setBillPayments(bill.bill_payments || []);

        const billItems = bill.bill_items || [];

        const spData = bill.bill_salespersons || [];
        setSelectedSalespersonIds(spData.map((r) => r.salesperson_id));
        setBillSalespersonNames(
          Object.fromEntries(spData.map((r) => [r.salesperson_id, r.salespersons?.name])),
        );

        // Rehydrate applied exchange credit so it shows when editing an existing bill.
        // Authoritative amount/source live on the bills row; the per-item breakdown
        // lives in `exchanges` (linked via new_billid) but may be absent if the source
        // bill was later edited — its bill_items delete cascades the exchange rows.
        const exAmount = Number(bill.exchange_credit_used ?? 0);
        if (exAmount > 0) {
          const linkedEx = bill.linked_exchanges;
          const items = (linkedEx || []).map((e) => ({
            product_name: e.bill_items?.product_name || e.product_name || "Item",
            returnQty: Number(e.quantity || 0),
            creditAmount: Number(e.credit_amount || 0),
          }));
          setExchangeCredit({
            amount: exAmount,
            label: `Exchange Credit${bill.exchange_source_bill ? ` — Bill #${bill.exchange_source_bill}` : ""}`,
            sourceBillNumber: bill.exchange_source_bill || null,
            exchangeIds: (linkedEx || []).map((e) => e.exchangeid),
            items,
          });
        }

        // Set form state from bill
        if (bill.customers) {
          preloadedCustomerRef.current = bill.customerid;
          applyCustomer(bill.customers);
          setLoadedCustomerId(bill.customerid);
        }
        // A finalized bill has already taken its credit from the customer, so it keeps that amount
        // rather than today's balance. A draft has taken none yet, so it offers the balance like a new bill.
        if (bill.finalized) setAppliedStoreCredit(Number(bill.store_credit_used ?? 0));
        setSelectedCustomerId(bill.customerid || null);
        setNotes(bill.notes || "");
        setSalesLocationId(bill.saleslocationid || null);
        setSalesMethodId(bill.salesmethodid || null);
        setPaymentAmount(bill.payment_amount ?? "");
        setFinalAmount(bill.final_amount != null ? String(bill.final_amount) : "");

        // Always set codes from saved state — prevents auto-codes racing in from loadDiscounts
        setSelectedCodes(bill.applied_codes || []);

        // Fetch size/color for manual items from manual_items table. product_code has no
        // foreign key to it, so this cannot join the bill request.
        const manualBillItems = billItems.filter(
          (bi) => !bi.variantid && bi.product_code,
        );
        let manualMap = {};
        if (manualBillItems.length > 0) {
          const { data: manuals } = await supabase
            .from("manual_items")
            .select("manual_item_id, size, color")
            .in(
              "manual_item_id",
              manualBillItems.map((bi) => bi.product_code),
            );
          if (superseded) return;
          manualMap = Object.fromEntries(
            (manuals || []).map((m) => [m.manual_item_id, m]),
          );
        }

        savedItemIdsRef.current = new Set(billItems.map((bi) => String(bi.bill_item_id)));
        const exchanged = {};
        let creditGiven = 0;
        for (const bi of billItems) {
          const qty = (bi.exchanges || []).reduce((n, e) => n + Number(e.quantity || 0), 0);
          creditGiven += (bi.exchanges || []).reduce((n, e) => n + Number(e.credit_amount || 0), 0);
          if (bi.exchanges?.length) {
            exchanged[String(bi.bill_item_id)] = { qty, savedQty: Number(bi.quantity), name: bi.product_name || "Item" };
          }
        }
        setExchangedById(exchanged);
        setExchangeCreditGiven(creditGiven);

        // Reconstruct items — product_code in DB stores the BC-format productid for inventory items
        setItems(
          billItems.map((bi) => ({
            _id: String(bi.bill_item_id),
            source: bi.variantid ? "inventory" : "manual",
            variantid: bi.variantid || null,
            productid: bi.product_code || null,
            product_name: bi.product_name || "",
            category: bi.category || null,
            categoryid: bi.category || null,
            cost_price: bi.cost_price ?? null,
            quantity: bi.quantity,
            unit_type: bi.unit_type || "piece",
            mrp: bi.mrp,
            alteration_charge: bi.alteration_charge || 0,
            quickDiscountPct: backCalcDiscountPct(
              bi.discount_total,
              bi.mrp,
              bi.quantity,
            ),
            gstRate: bi.gst_rate ?? 18,
            stitchType:
              bi.stitch_type ||
              (Number(bi.gst_rate) === 18 ? "stitched" : "unstitched"),
            size:
              bi.productsizecolors?.size ||
              manualMap[bi.product_code]?.size ||
              null,
            color:
              bi.productsizecolors?.color ||
              manualMap[bi.product_code]?.color ||
              null,
            salesperson_id: bi.salesperson_id || null,
          })),
        );
        // Set only on success: saving a half-loaded bill would overwrite the real one.
        setBillLoaded(true);
      } catch (e) {
        if (!superseded) toast.error("Error loading bill", { description: e.message });
      }
    };
    loadBill();
    return () => {
      superseded = true;
    };
  }, [open, billId]); // eslint-disable-line react-hooks/exhaustive-deps

  function applyCustomer(data) {
    const name = data ? `${data.first_name} ${data.last_name || ""}`.trim() : "";
    setCustomerName(name);
    setCustomerDisplayText(data ? `${name} | ${data.phone || "No Phone"}` : "");
    // D-16: auto-apply the full balance; Summary/computation will clamp to grandTotal
    const balance = Number(data?.store_credit ?? 0);
    setCustomerStoreCreditBalance(balance);
    // A finalized bill keeps the credit it took (loadBill sets it): another customer's balance was
    // never taken, and bill_edit refuses store credit going up.
    if (!isFinalizedBill) setAppliedStoreCredit(balance);
    setAvailableExchangeCredit(exchangeCreditProp ? null : pendingExchangeCredit(data?.exchanges));
    // D-05: hides once_per_customer discounts already used. This bill's own use does not count,
    // or reopening it would drop the discount it was finalized with.
    setUsedCodeSet(
      new Set((data?.discount_usage || []).filter((r) => String(r.billid) !== String(billId)).map((r) => r.code)),
    );
  }

  // Load what the form shows about a customer whenever the choice changes.
  useEffect(() => {
    if (!selectedCustomerId) {
      applyCustomer(null);
      setLoadedCustomerId(null);
      return undefined;
    }
    if (preloadedCustomerRef.current === selectedCustomerId) {
      preloadedCustomerRef.current = null;
      return undefined;
    }
    let superseded = false;
    supabase
      .from("customers")
      .select(CUSTOMER_SELECT)
      .eq("customerid", selectedCustomerId)
      .is("exchanges.new_billid", null)
      .single()
      .then(({ data, error }) => {
        if (superseded) return;
        if (error) {
          toast.error("Could not load customer", { description: error.message });
        }
        applyCustomer(data);
        setLoadedCustomerId(selectedCustomerId);
      });
    return () => {
      superseded = true;
    };
  }, [selectedCustomerId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Deselect once_per_customer codes this customer already used. Either list can arrive first.
  useEffect(() => {
    if (usedCodeSet.size === 0) return;
    setSelectedCodes((prev) =>
      prev.filter((c) => {
        const disc = allDiscounts.find((d) => d.code === c);
        return !(disc && disc.once_per_customer && usedCodeSet.has(c));
      }),
    );
  }, [usedCodeSet, allDiscounts]);

  const salespersonMap = useMemo(
    () =>
      Object.fromEntries(
        salespersonsList.map((s) => [s.salesperson_id, s.name]),
      ),
    [salespersonsList],
  );

  const salespersonNames = useMemo(
    () =>
      selectedSalespersonIds
        .map((id) => salespersonMap[id] || billSalespersonNames[id])
        .filter(Boolean),
    [selectedSalespersonIds, salespersonMap, billSalespersonNames],
  );

  // Totals depend on discount definitions, so saving before they arrive would store wrong totals.
  // A new bill also needs them for auto-apply. An existing bill with no codes does not wait.
  const discountsPending = discountStatus !== "ready" && (!billId || selectedCodes.length > 0);
  const billPending = Boolean(billId) && !billLoaded;
  const customerPending = Boolean(selectedCustomerId) && loadedCustomerId !== selectedCustomerId;
  // Only when the date was changed here: older rows hold the database's clock, which can read a day
  // behind India, and must not stop an untouched bill from saving.
  const earliestPaymentDate = billPayments
    .map((p) => String(p.recorded_at).slice(0, 10))
    .sort()[0];
  const billDateAfterPayment =
    Boolean(earliestPaymentDate) &&
    backdatedDate !== loadedBillDate &&
    backdatedDate > earliestPaymentDate;
  // Paid in installments (or finalized with nothing paid): payments live in bill_payments and are
  // recorded one by one, so the single Payment Amount box and Finalize do not apply.
  const paidInInstallments = billPaymentStatus === "partial" || billPayments.length > 0;
  // Cancelled bills are locked: bill_cancel already put back stock and credit, so a save here
  // would charge them again. A sale is redone as a new bill.
  const billCancelled = billPaymentStatus === "cancelled";
  const saveBlocked =
    billCancelled ||
    billPending ||
    discountsPending ||
    customerPending ||
    !backdatedDate ||
    billDateAfterPayment ||
    Boolean(unfinishedBill);
  const saveBlockedReason = billCancelled
    ? "Cancelled bill — create a new bill instead."
    : billPending
    ? "Loading bill…"
    : discountsPending
      ? discountStatus === "failed"
        ? "Discounts did not load. Retry to save."
        : "Loading discounts…"
      : customerPending
        ? "Loading customer…"
        : !backdatedDate
          ? "Choose a bill date to save."
          : billDateAfterPayment
            ? `Bill date cannot be after the first payment (${formatDate(earliestPaymentDate)}).`
            : null;
  const discountsShown =
    discountsOpen || discountStatus === "failed" || selectedCodes.length > 0 || Boolean(appliedVoucher);

  // What Cancel would lose. Payment amount is left out once installments exist, since recording one
  // saves it straight away.
  const formSnapshot = JSON.stringify([
    items,
    selectedCustomerId,
    selectedSalespersonIds,
    notes,
    paidInInstallments ? null : paymentAmount,
    finalAmount,
    backdatedDate,
    salesMethodId,
    appliedVoucher,
    selectedCodes,
    docType,
    appliedStoreCredit,
    exchangeCredit?.amount ?? null,
    addPaymentAmount,
    // A new bill fills in Walk-In by itself once the list arrives, so that is not an edit.
    billId ? salesLocationId : null,
  ]);

  // What a bill's PDF is priced from, so recording a payment can tell whether it was edited.
  const pricingSnapshot = JSON.stringify([items, selectedCodes, docType, appliedVoucher, finalAmount]);

  useEffect(() => {
    if (!open) {
      cleanSnapshotRef.current = null;
      cleanPricingRef.current = null;
    } else if (cleanSnapshotRef.current === null && (!billId || billLoaded)) {
      cleanSnapshotRef.current = formSnapshot;
      cleanPricingRef.current = pricingSnapshot;
    }
  }, [open, billId, billLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const requestClose = () => {
    if (cleanSnapshotRef.current !== null && cleanSnapshotRef.current !== formSnapshot) {
      setDiscardOpen(true);
    } else {
      onOpenChange?.(false);
    }
  };

  // Late bills are common, so a payment can be dated anywhere from the bill's date up to today.
  const paymentDateProblem = (date) => {
    if (!date) return "Choose the date this payment was received";
    if (date > todayIST()) return "A payment date cannot be in the future";
    if (backdatedDate && date < backdatedDate) return "A payment date cannot be before the bill date";
    return null;
  };

  const computed = useMemo(
    () =>
      computeBillTotals(
        items,
        selectedCodes,
        allDiscounts,
        0,
        Number(appliedVoucher?.value ?? 0),
        docType,
      ),
    [items, selectedCodes, allDiscounts, appliedVoucher, docType],
  );

  // Total forced to what the customer paid (see computeBalanceAdjustedTotals).
  const balanceAdjustedComputed = useMemo(() => {
    const { effectiveTotal: effectiveGrandTotal } = computeCreditsApplied(
      computed.grandTotal,
      appliedStoreCredit,
      exchangeCredit?.amount,
    );
    return computeBalanceAdjustedTotals(computed, {
      finalAmount,
      paymentAmount,
      effectiveGrandTotal,
      items,
      selectedCodes,
      allDiscounts,
      voucherPreTax: Number(appliedVoucher?.value ?? 0),
      docType,
    });
  }, [
    computed,
    finalAmount,
    paymentAmount,
    appliedStoreCredit,
    exchangeCredit,
    items,
    selectedCodes,
    allDiscounts,
    appliedVoucher,
    docType,
  ]);

  // A finalized bill's routine "Save Draft" edit does not force-fit the total to finalAmount.
  const shownComputed = isFinalizedBill ? computed : balanceAdjustedComputed;

  const visibleDiscounts = useMemo(() => {
    const offered = allDiscounts.filter((d) => !d.savedOnBillOnly || selectedCodes.includes(d.code));
    if (!selectedCustomerId) return offered; // D-06: no filter without customer
    return offered.filter(
      (d) => !(d.once_per_customer && usedCodeSet.has(d.code)),
    );
  }, [allDiscounts, usedCodeSet, selectedCustomerId, selectedCodes]);

  // Same 30% limit as the per-item discount warning, applied to the discount a Final Amount creates.
  // Display only: nothing here changes an amount or what is saved.
  const finalAmountDiscountOverLimit = useMemo(() => {
    if (!(Number(finalAmount) > 0)) return false;
    const { effectiveTotal } = computeCreditsApplied(
      computed.grandTotal,
      appliedStoreCredit,
      exchangeCredit?.amount
    );
    if (!(effectiveTotal > 0)) return false;
    return ((effectiveTotal - Number(finalAmount)) / effectiveTotal) * 100 > 30;
  }, [finalAmount, computed, appliedStoreCredit, exchangeCredit]);

  const showPartialButton = useMemo(() => {
    if (isFinalizedBill || billPaymentStatus === "cancelled") return false;
    if (billPaymentStatus === "partial") return false;
    const { effectiveTotal } = computeCreditsApplied(
      computed.grandTotal,
      appliedStoreCredit,
      exchangeCredit?.amount
    );
    return effectiveTotal - Number(paymentAmount) > 100;
  }, [isFinalizedBill, billPaymentStatus, paymentAmount, computed, appliedStoreCredit, exchangeCredit]);

  const exchangeBalance = useMemo(
    () => computeExchangeBalance(balanceAdjustedComputed.grandTotal, appliedStoreCredit, exchangeCredit?.amount),
    [balanceAdjustedComputed, appliedStoreCredit, exchangeCredit],
  );

  const handleApplyVoucher = async () => {
    const code = voucherCode.trim();
    if (!code) return;
    setVoucherLoading(true);
    setVoucherError("");
    try {
      const today = todayIST();
      const { data, error } = await supabase
        .from("vouchers")
        .select("voucher_id, customerid, expiry_date, value, redeemed, held_order_id")
        .eq("voucher_id", code)
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        setVoucherError("Voucher code not found or already redeemed.");
        return;
      }
      if (data.redeemed) {
        setVoucherError("Voucher code not found or already redeemed.");
        return;
      }
      if (data.held_order_id != null) {
        setVoucherError("This voucher is reserved for an online order");
        return;
      }
      if (data.expiry_date && data.expiry_date < today) {
        setVoucherError("This voucher has expired.");
        return;
      }
      if (
        data.customerid !== null &&
        data.customerid !== undefined &&
        selectedCustomerId !== null &&
        selectedCustomerId !== undefined &&
        String(data.customerid) !== String(selectedCustomerId)
      ) {
        setVoucherError("This voucher is assigned to a different customer.");
        return;
      }
      // Valid
      setAppliedVoucher({
        voucher_id: data.voucher_id,
        value: Number(data.value ?? 0),
      });
      setVoucherCode("");
    } catch (e) {
      setVoucherError(
        e?.message || "Could not apply voucher. Please try again.",
      );
    } finally {
      setVoucherLoading(false);
    }
  };

  const regenerateBillPdf = async ({ activeBillId, pdfBillNumber }) => {
    if (!invoiceRef.current) throw new Error("InvoiceView ref missing");

    const blob = await generateInvoicePdf(invoiceRef.current);
    const billLabel = pdfBillNumber || activeBillId;
    // Versioned filename so each regen yields a fresh URL (no CDN/browser cache)
    const newPath = `bill-${billLabel}-v${Date.now()}.pdf`;
    // Remove legacy/previous versions (bucket is private; stale files just waste space)
    await supabase.storage
      .from("invoices")
      .remove([`bill-${billLabel}.pdf`, `bill-${activeBillId}.pdf`]);

    const { error: upErr } = await supabase.storage
      .from("invoices")
      .upload(newPath, blob, { contentType: "application/pdf", upsert: true });

    if (upErr) throw upErr;

    // Store the bare path (not a public URL) — bucket is private, so callers
    // must mint a signed URL. BillTable.handleViewPdf/SMS extract this path.
    const { error: urlErr } = await supabase
      .from("bills")
      .update({ pdf_url: newPath })
      .eq("billid", activeBillId);

    if (urlErr) throw urlErr;

    // Signed URL for the immediate "open in new tab" after finalize
    const { data: signedData } = await supabase.storage
      .from("invoices")
      .createSignedUrl(newPath, 3600);

    return signedData?.signedUrl ?? null;
  };

  // BILL-01 + STOCK-01: New draft save | BILL-02 + STOCK-02: Draft update (Plan 03)
  // Errors that stop a save also show in a red box by the Save buttons, so they
  // do not vanish like a toast. Cleared on the next save attempt or when the
  // items or payment change.
  const lockIfBillSaved = (step) => {
    const saved = newBillRef.current;
    if (!saved) return;
    setUnfinishedBill({ number: saved.number, step });
    setConfirmOpen(false);
    setPartialConfirmOpen(false);
  };

  // A new bill, or a saved draft being finished, is saved by bill_save in one transaction: the
  // bill, its items and salespeople, stock, the voucher, exchange links, discount use, store credit
  // and the first payment all happen or none do. A failure leaves nothing to undo, so no finalized
  // bill is ever deleted (deleting one freed its exchange credit to be spent again), and a draft
  // is never left half finished. Returns { billid, bill_number, payment, ... }.
  const saveBill = async (op, payload) => {
    if (!saveKeyRef.current) saveKeyRef.current = crypto.randomUUID();
    const { data, error } = await supabase.rpc("bill_save", {
      p_key: saveKeyRef.current,
      p_op: op,
      p_payload: payload,
    });
    if (!error) return data;
    if (error.message === "BILL_VOUCHER_REFUSED") {
      throw new Error(
        `Voucher ${payload.voucher_id} can no longer be used (already redeemed, expired or reserved for an online order). Bill not finalized.`,
      );
    }
    if (error.message === "BILL_CREDIT_SHORT") throw new Error(creditShortMessage(error.details));
    throw new Error(
      BILL_SAVE_ERRORS[error.message] ||
        "Failed to save bill: " + error.message + (error.details ? ` (${error.details})` : ""),
    );
  };

  // An opened bill's lines with each saved one's bill_item_id, so bill_save and bill_edit change
  // that line in place: exchange credit given for it points at that id.
  const linesForSavedBill = (payload) => linesWithSavedIds(savedItemIdsRef.current, items, payload);

  // Why the stock an opened bill's edit takes cannot be met, or null. A read only: bill_save and
  // bill_edit move the stock in the same transaction as the lines.
  const editStockProblems = async (id) => {
    const { data: existingItems, error: fetchErr } = await supabase
      .from("bill_items")
      .select("variantid, quantity")
      .eq("billid", id)
      .not("variantid", "is", null);
    if (fetchErr) throw new Error("Could not fetch existing items: " + fetchErr.message);
    const newInventoryItems = items.filter((it) => it.variantid);
    const deltaMap = computeStockDelta(existingItems || [], newInventoryItems);
    const allVariantIds = Object.keys(deltaMap);
    if (allVariantIds.length === 0) return null;
    const { data: stockData, error: stockErr } = await supabase
      .from("productsizecolors")
      .select("variantid, stock, size, color")
      .in("variantid", allVariantIds);
    if (stockErr) throw new Error("Could not verify stock: " + stockErr.message);
    const stockMap = Object.fromEntries(stockData.map((r) => [r.variantid, r]));
    const stockErrors = [];
    for (const [vid, delta] of Object.entries(deltaMap)) {
      const finalStock = (stockMap[vid]?.stock ?? 0) + delta;
      if (finalStock < 0) {
        const item = newInventoryItems.find((it) => it.variantid === vid);
        stockErrors.push(
          `${item?.product_name || vid} (${stockMap[vid]?.size || ""}/${stockMap[vid]?.color || ""}): would result in ${finalStock} stock`,
        );
      }
    }
    return stockErrors.length > 0 ? stockErrors.join("\n") : null;
  };

  const shownError = unfinishedBill
    ? {
        title: "Bill not finished",
        description: `Bill ${unfinishedBill.number} was saved but not finished. Do not enter it again. Close this window, and tell the owner which step failed: ${unfinishedBill.step}.`,
      }
    : blockingError;
  const showBlockingError = (title, description) => {
    toast.error(title, { description });
    setBlockingError({ title, description });
  };
  useEffect(() => {
    setBlockingError(null);
  }, [items, paymentAmount, salesMethodId]);

  // settlement: the refund or store credit staff chose for an excess, { mode, amount, salesmethodid }.
  const handleSaveDraft = async (settlement = null) => {
    setBlockingError(null);
    if (saveBlocked) return;
    setIsSaving(true);
    try {
      if (billId) {
        // BILL-02 + STOCK-02: Draft update with stock reconciliation

        // Step A: Validate items exist
        if (items.length === 0) {
          toast.error("Add at least one item");
          return;
        }
        const exchangedProblems = exchangedLineProblems(items, exchangedById);
        if (exchangedProblems) {
          showBlockingError("Exchanged items stay on the bill", exchangedProblems);
          return;
        }

        // Stock check only: bill_edit moves the stock with the lines (skipped for backdated bills)
        if (!isBackdated) {
          const stockProblems = await editStockProblems(billId);
          if (stockProblems) {
            showBlockingError("Insufficient stock", stockProblems);
            return;
          }
        }

        const { effectiveTotal: editEffectiveTotal } = computeCreditsApplied(
          computed.grandTotal,
          appliedStoreCredit,
          exchangeCredit?.amount,
        );
        // Taking items off a paid bill can leave the shop holding more than the new net. Staff
        // choose what happens to it before anything is written; bill_edit records it with the bill.
        const excess = editExcess({
          paymentStatus: openedStateRef.current?.paymentstatus,
          payments: billPayments,
          paymentAmount: openedStateRef.current?.payment_amount,
          netAmount: editEffectiveTotal,
        });
        if (excessCountsExchangeTwice({ excess, netAmount: editEffectiveTotal, exchangeCreditGiven })) {
          showBlockingError(
            "Already given back as exchange credit",
            `${billMoney(exchangeCreditGiven)} of this bill was given back as exchange credit, so its total cannot go below that when money is paid back.`,
          );
          return;
        }
        if (excess > 0 && settlement?.amount !== excess) {
          setExcessMode(selectedCustomerId ? "store_credit" : null);
          setExcessMethodId(salesMethodId);
          setExcessPrompt({ amount: excess });
          return;
        }

        // NOTE: routine edits never re-run the balance-forcing math (balanceAdjustedComputed) —
        // that mechanism exists only for the explicit "confirm partial finalize" action
        // (handleConfirmPartialFinalize). Reusing it here silently discounted away the cost of
        // any item added after a bill's finalAmount/paymentAmount was locked in.
        const totalsToUse = computed;

        // Lines, stock, salespeople, the bills row and any excess, in one transaction (bill_edit),
        // and only while the bill is as this window loaded it.
        const editBody = {
          expect: openedStateRef.current,
          bill: {
            customerid: selectedCustomerId || null,
            notes: notes || null,
            totalamount: totalsToUse.grandTotal,
            gst_total: totalsToUse.gstTotal,
            discount_total:
              totalsToUse.itemLevelDiscountTotal + totalsToUse.overallDiscount,
            taxable_total: totalsToUse.taxableTotal,
            net_amount: editEffectiveTotal,
            applied_codes: selectedCodes,
            payment_amount: paymentAmount !== "" ? Number(paymentAmount) : null,
            final_amount: finalAmount !== "" ? Number(finalAmount) : null,
            saleslocationid: salesLocationId || null,
            salesmethodid: salesMethodId || null,
            ...billStatusFields(
              paymentStatusAfterEdit({
                finalized: isFinalizedBill,
                paymentStatus: billPaymentStatus,
                payments: billPayments,
                netAmount: editEffectiveTotal,
              }),
            ),
            store_credit_used: isFinalizedBill
              ? Math.min(
                  Number(appliedStoreCredit || 0),
                  totalsToUse.grandTotal,
                )
              : 0,
            orderdate: backdatedDate + "T00:00:00+05:30",
          },
          excess: excess > 0 ? settlement : null,
          items: linesForSavedBill(buildBillItemsPayload(null, items, 0, totalsToUse.overallDiscount, docType)),
          salesperson_ids: selectedSalespersonIds,
          skip_stock: isBackdated,
        };
        const editBodyText = JSON.stringify(editBody);
        if (editKeyRef.current?.body !== editBodyText) {
          editKeyRef.current = { key: crypto.randomUUID(), body: editBodyText };
        }
        const { data: edited, error: editErr } = await supabase.rpc("bill_edit", {
          p_key: editKeyRef.current.key,
          p_billid: billId,
          p_payload: editBody,
        });
        if (editErr) {
          throw new Error(BILL_EDIT_ERRORS[editErr.message] || "Failed to update bill: " + editErr.message);
        }

        // Step J: Success
        toast.success(isFinalizedBill ? `Bill saved — #${effectiveBillNumber || billId}` : `Draft saved — Bill #${billId}`);
        if (edited?.excess?.mode === "store_credit") {
          toast.success(`${billMoney(edited.excess.amount)} added to ${customerName || "the customer"}'s store credit`);
        } else if (edited?.excess?.mode === "refund") {
          toast.success(`Give the customer ${billMoney(edited.excess.amount)} back — recorded as a refund on the bill`);
        }
        logActivity({ action: "update", entityType: "bill", entityId: effectiveBillNumber || billId, summary: `Edited draft bill #${effectiveBillNumber || "(no number)"} for ${customerName || "walk-in"} — ${money(totalsToUse.grandTotal)}, ${items.length} items` });
        onOpenChange?.(false);
        onSubmit?.();
        return;
      }

      // New draft path
      if (items.length === 0) {
        toast.error("Add at least one item");
        return;
      }

      // Step B - Stock validation per D-01 (skipped for backdated bills)
      const inventoryItems = items.filter((it) => it.variantid);
      let stockMap = {};
      if (!isBackdated && inventoryItems.length > 0) {
        const variantIds = inventoryItems.map((it) => it.variantid);
        const { data: stockData, error: stockErr } = await supabase
          .from("productsizecolors")
          .select("variantid, stock, size, color")
          .in("variantid", variantIds);
        if (stockErr)
          throw new Error("Could not verify stock: " + stockErr.message);

        stockMap = Object.fromEntries(stockData.map((r) => [r.variantid, r]));
        const shortfalls = describeStockShortfalls(inventoryItems, stockMap);
        if (shortfalls) {
          showBlockingError("Insufficient stock", shortfalls);
          return;
        }
      }

      // Step C - Insert bills row
      const { data: bill, error: billError } = await supabase
        .from("bills")
        .insert({
          customerid: selectedCustomerId || null,
          stock_reduced: !isBackdated,
          notes: notes || null,
          document_type: docType,
          totalamount: computed.grandTotal,
          gst_total: computed.gstTotal,
          discount_total:
            computed.itemLevelDiscountTotal + computed.overallDiscount,
          taxable_total: computed.taxableTotal,
          ...billStatusFields(BILL_STATUS.DRAFT),
          applied_codes: selectedCodes,
          payment_amount: paymentAmount !== "" ? Number(paymentAmount) : null,
          final_amount: finalAmount !== "" ? Number(finalAmount) : null,
          saleslocationid: salesLocationId || null,
          salesmethodid: salesMethodId || null,
          orderdate: backdatedDate + "T00:00:00+05:30",
        })
        .select("billid, bill_number")
        .single();
      if (billError)
        throw new Error("Failed to save bill: " + billError.message);

      // Step D - Insert bill_items
      const billItemsPayload = buildBillItemsPayload(
        bill.billid,
        items,
        0,
        computed.overallDiscount,
        docType,
      );
      const { error: itemsError } = await supabase
        .from("bill_items")
        .insert(billItemsPayload);
      if (itemsError) {
        // Best-effort cleanup of dangling bills row (Pitfall 6)
        await supabase.from("bills").delete().eq("billid", bill.billid);
        throw new Error("Failed to save bill items: " + itemsError.message);
      }

      // Save salesperson associations
      if (selectedSalespersonIds.length > 0) {
        const spPayload = selectedSalespersonIds.map((spId) => ({
          billid: bill.billid,
          salesperson_id: spId,
        }));
        const { error: spErr } = await supabase
          .from("bill_salespersons")
          .insert(spPayload);
        if (spErr) console.error("Failed to save salespersons:", spErr.message);
      }

      // Step E - Decrement stock for inventory items (skipped for backdated bills)
      const newDraftStockFailures = [];
      if (!isBackdated) {
        newDraftStockFailures.push(
          ...(await applyStockChanges(
            Object.entries(computeStockDelta([], inventoryItems)),
            "bill_draft_create",
            bill.billid,
          )),
        );
      }

      // Step F - Success
      toast.success(`Draft saved — Bill #${bill.bill_number || "(no number)"}`);
      if (newDraftStockFailures.length > 0) {
        toast.error("Stock sync warning", {
          description: `Stock could not be updated for ${newDraftStockFailures.length} variant(s). Please recheck inventory.`,
        });
      }
      logActivity({ action: "create", entityType: "bill", entityId: bill.bill_number || bill.billid, summary: `Created draft bill #${bill.bill_number || "(no number)"} for ${customerName || "walk-in"} — ${money(computed.grandTotal)}, ${items.length} items` });
      onOpenChange?.(false);
      onSubmit?.();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setIsSaving(false);
    }
  };

  const openFinalizeConfirm = () => {
    setBlockingError(null);
    // D-06: Customer required to finalize
    if (!selectedCustomerId) {
      toast.error("Customer required", {
        description: "A customer must be selected before finalizing.",
      });
      return;
    }
    // Warn cashier to add more items before handling balance
    if (exchangeBalance > 0 && !exchangeBalanceAcknowledged) {
      toast.error("Review exchange balance", {
        description: `Exchange credit has ₹${exchangeBalance.toFixed(2)} excess. Add more items or confirm balance handling in the summary.`,
      });
      return;
    }
    // Require balance mode once acknowledged
    if (exchangeBalance > 0 && !exchangeBalanceMode) {
      toast.error("Select balance option", {
        description: `Choose to add ₹${exchangeBalance.toFixed(2)} to store credit or refund as cash.`,
      });
      return;
    }

    const { effectiveTotal: effectiveGrandTotal } = computeCreditsApplied(
      balanceAdjustedComputed.grandTotal,
      appliedStoreCredit,
      exchangeCredit?.amount,
    );

    // Validate payment fields only when customer still owes money
    const paidAmt = Number(paymentAmount);
    if (effectiveGrandTotal > 0) {
      if (!salesMethodId || !paymentAmount) {
        toast.error("Payment required", {
          description:
            "Select a payment method and enter the amount received before finalizing.",
        });
        return;
      }
    }

    if (effectiveGrandTotal > 0 && Math.abs(paidAmt - effectiveGrandTotal) > 100) {
      const diff = (paidAmt - effectiveGrandTotal).toFixed(2);
      const msg =
        diff > 0
          ? `Amount received is ₹${Math.abs(diff)} more than the total (₹${effectiveGrandTotal.toFixed(2)}).`
          : `Amount received is ₹${Math.abs(diff)} short of the total (₹${effectiveGrandTotal.toFixed(2)}).`;
      showBlockingError("Payment mismatch", msg + " Must be within ₹100.");
      return;
    }
    setDiscountWarningAcked(false);
    setConfirmOpen(true);
  };

  const openPartialFinalizeConfirm = () => {
    setBlockingError(null);
    setFirstPaymentDate(backdatedDate);
    if (!selectedCustomerId) {
      toast.error("Customer required", {
        description: "A customer must be selected before finalizing.",
      });
      return;
    }
    const paidAmt = Number(paymentAmount);
    if (paidAmt < 0) {
      toast.error("Amount cannot be negative");
      return;
    }
    if (paidAmt > 0 && !salesMethodId) {
      toast.error("Payment required", {
        description: "Select a payment method for the amount received.",
      });
      return;
    }
    if (Number(finalAmount) > 0) {
      const { effectiveTotal } = computeCreditsApplied(
        computed.grandTotal,
        appliedStoreCredit,
        exchangeCredit?.amount,
      );
      if (Number(finalAmount) > effectiveTotal + 0.01) {
        toast.error("Final amount exceeds bill total", {
          description: `Maximum: ₹${effectiveTotal.toFixed(2)}`,
        });
        return;
      }
      if (Number(paymentAmount) > Number(finalAmount) + 0.01) {
        toast.error("Deposit cannot exceed final amount");
        return;
      }
    }
    const alterMin = computeAlterationDeposit(items);
    if (alterMin > 0 && paidAmt < alterMin) {
      toast.error("Insufficient initial payment", {
        description: `Must pay at least ₹${alterMin.toFixed(2)} to cover altered items.`,
      });
      return;
    }
    setDiscountWarningAcked(false);
    setPartialConfirmOpen(true);
  };

  const handleConfirmFinalize = async () => {
    setBlockingError(null);
    if (saveBlocked) return;
    setIsSaving(true);
    let activeBillId = billId;
    let pdfBillNumber = effectiveBillNumber;
    // Single source of truth for credit splitting (mirrors Summary + balance-adjusted memo)
    const { storeCreditUsed, exchangeCreditUsed } = computeCreditsApplied(
      balanceAdjustedComputed.grandTotal,
      appliedStoreCredit,
      exchangeCredit?.amount,
    );
    // What bill_save is sent, for a new bill and for a saved draft alike.
    const finalBill = {
      customerid: selectedCustomerId || null,
      notes: notes || null,
      totalamount: balanceAdjustedComputed.grandTotal,
      gst_total: balanceAdjustedComputed.gstTotal,
      discount_total:
        balanceAdjustedComputed.itemLevelDiscountTotal +
        balanceAdjustedComputed.overallDiscount +
        balanceAdjustedComputed.balanceDiscount,
      taxable_total: balanceAdjustedComputed.taxableTotal,
      ...billStatusFields(BILL_STATUS.FINALIZED),
      applied_codes: selectedCodes,
      payment_amount: paymentAmount !== "" ? Number(paymentAmount) : null,
      store_credit_used: storeCreditUsed,
      exchange_credit_used: exchangeCreditUsed,
      exchange_source_bill: exchangeCredit?.sourceBillNumber || null,
      exchange_cash_refund: exchangeBalanceMode === "cash_refund" ? exchangeBalance : 0,
      saleslocationid: salesLocationId || null,
      salesmethodid: salesMethodId || null,
      orderdate: backdatedDate + "T00:00:00+05:30",
    };
    const finalLines = buildBillItemsPayload(
      null,
      items,
      balanceAdjustedComputed.balanceDiscount || 0,
      balanceAdjustedComputed.overallDiscount,
      docType,
    );
    const finalSaveFields = {
      salesperson_ids: selectedSalespersonIds,
      // "Don't reduce stock": bill_save then moves none and records stock_reduced false.
      skip_stock: isBackdated,
      voucher_id: appliedVoucher?.voucher_id || null,
      exchange_ids: exchangeCredit?.exchangeIds || [],
      exchange_balance_to_credit:
        exchangeBalance > 0 && exchangeBalanceMode === "store_credit" && selectedCustomerId ? exchangeBalance : 0,
      discount_codes: selectedCodes,
    };
    try {
      if (!activeBillId) {
        // New bill: validate, create, and finalize in one step
        if (items.length === 0) {
          toast.error("Add at least one item");
          return;
        }

        // Stock validation
        const inventoryItems = items.filter((it) => it.variantid);
        let stockMap = {};
        if (inventoryItems.length > 0) {
          const variantIds = inventoryItems.map((it) => it.variantid);
          const { data: stockData, error: stockErr } = await supabase
            .from("productsizecolors")
            .select("variantid, stock, size, color")
            .in("variantid", variantIds);
          if (stockErr)
            throw new Error("Could not verify stock: " + stockErr.message);
          stockMap = Object.fromEntries(stockData.map((r) => [r.variantid, r]));
          if (!isBackdated) {
            const shortfalls = describeStockShortfalls(inventoryItems, stockMap);
            if (shortfalls) {
              showBlockingError("Insufficient stock", shortfalls);
              return;
            }
          }
        }

        // Create bill as finalized, in one bill_save transaction
        const bill = await saveBill("finalize_create", {
          bill: { ...finalBill, document_type: docType },
          // The balance-waiver discount distributed proportionally.
          items: finalLines,
          ...finalSaveFields,
        });
        activeBillId = bill.billid;
        newBillRef.current = { id: bill.billid, number: bill.bill_number || `#${bill.billid}` };
        setEffectiveBillNumber(bill.bill_number || null);
        pdfBillNumber = bill.bill_number || null;

        // Flush finalized state into InvoiceView before PDF capture
        flushSync(() => {
          setBillPaymentStatus("finalized");
          setEffectiveBillId(activeBillId);
          setStockChoiceLocked(true);
        });
      } else if (!isFinalizedBill) {
        // A saved draft is finished by bill_save in one transaction (finalize_draft): its lines,
        // stock, voucher, exchange links, store credit and discount use all happen or none do,
        // and only while the draft is still as this window loaded it.
        if (!isBackdated) {
          const stockProblems = await editStockProblems(activeBillId);
          if (stockProblems) {
            showBlockingError("Insufficient stock", stockProblems);
            return;
          }
        }
        await saveBill("finalize_draft", {
          billid: activeBillId,
          expect: openedStateRef.current,
          bill: finalBill,
          items: linesForSavedBill(finalLines),
          ...finalSaveFields,
        });
      } else {
        // Finalize on an opened finalized bill saves through bill_edit, as Save Changes does: lines,
        // stock, salespeople, the bill row, store credit given back for a cut and discount use, in
        // one transaction. More received than before is recorded as a payment; less is refused.
        const exchangedProblems = exchangedLineProblems(items, exchangedById);
        if (exchangedProblems) {
          showBlockingError("Exchanged items stay on the bill", exchangedProblems);
          return;
        }
        if (!isBackdated) {
          const stockProblems = await editStockProblems(activeBillId);
          if (stockProblems) {
            showBlockingError("Insufficient stock", stockProblems);
            return;
          }
        }
        const { effectiveTotal } = computeCreditsApplied(
          balanceAdjustedComputed.grandTotal,
          appliedStoreCredit,
          exchangeCredit?.amount,
        );
        const editBody = {
          expect: openedStateRef.current,
          bill: {
            customerid: finalBill.customerid,
            notes: finalBill.notes,
            totalamount: finalBill.totalamount,
            gst_total: finalBill.gst_total,
            discount_total: finalBill.discount_total,
            taxable_total: finalBill.taxable_total,
            net_amount: effectiveTotal,
            applied_codes: finalBill.applied_codes,
            payment_amount: finalBill.payment_amount,
            final_amount: finalAmount !== "" ? Number(finalAmount) : null,
            saleslocationid: finalBill.saleslocationid,
            salesmethodid: finalBill.salesmethodid,
            ...billStatusFields(BILL_STATUS.FINALIZED),
            store_credit_used: finalBill.store_credit_used,
            orderdate: finalBill.orderdate,
          },
          excess: null,
          items: linesForSavedBill(finalLines),
          salesperson_ids: selectedSalespersonIds,
          skip_stock: isBackdated,
          discount_codes: selectedCodes,
        };
        const editBodyText = JSON.stringify(editBody);
        if (editKeyRef.current?.body !== editBodyText) {
          editKeyRef.current = { key: crypto.randomUUID(), body: editBodyText };
        }
        const { error: editErr } = await supabase.rpc("bill_edit", {
          p_key: editKeyRef.current.key,
          p_billid: activeBillId,
          p_payload: editBody,
        });
        if (editErr) {
          throw new Error(
            REFINALIZE_ERRORS[editErr.message] ||
              BILL_EDIT_ERRORS[editErr.message] ||
              "Failed to update bill: " + editErr.message,
          );
        }
      }

      // Flush finalized state into InvoiceView before PDF capture (covers existing-bill path)
      flushSync(() => {
        setBillPaymentStatus("finalized");
        setEffectiveBillId(activeBillId);
        setStockChoiceLocked(true);
      });

      // Steps 5-7: PDF generate + upload + pdf_url update
      let pdfUrl = null;
      try {
        pdfUrl = await regenerateBillPdf({ activeBillId, pdfBillNumber });
      } catch (pdfErr) {
        console.error("PDF generation failed:", pdfErr);
        toast.error("PDF generation failed", {
          description:
            pdfErr?.message ||
            "Bill is finalized. You can reprint from the Bill List.",
        });
      }

      // Step 8: open PDF in new tab if we got a URL
      if (pdfUrl) {
        window.open(pdfUrl, "_blank");
      }

      // Steps 9-10: success toast + close
      toast.success(`Bill #${activeBillId} finalized`);
      if (billId) {
        logActivity({ action: "update", entityType: "bill", entityId: effectiveBillNumber || billId, summary: `Re-finalized bill #${effectiveBillNumber || "(no number)"} for ${customerName || "walk-in"} — ${money(balanceAdjustedComputed.grandTotal)}, ${items.length} items` });
      } else {
        logActivity({ action: "create", entityType: "bill", entityId: pdfBillNumber || activeBillId, summary: `Finalized bill #${pdfBillNumber || "(no number)"} for ${customerName || "walk-in"} — ${money(balanceAdjustedComputed.grandTotal)}, ${items.length} items` });
      }
      setConfirmOpen(false);
      onOpenChange?.(false);
      onSubmit?.();
    } catch (e) {
      toast.error(e.message);
      lockIfBillSaved("finishing the bill");
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmPartialFinalize = async () => {
    setBlockingError(null);
    if (saveBlocked) return;
    const firstDateProblem = Number(paymentAmount) > 0 ? paymentDateProblem(firstPaymentDate) : null;
    if (firstDateProblem) {
      toast.error(firstDateProblem);
      return;
    }
    setIsSaving(true);
    let activeBillId = billId || null;
    let pdfBillNumber = billId ? effectiveBillNumber : null;
    const billComputed = Number(finalAmount) > 0 ? balanceAdjustedComputed : computed;
    const { storeCreditUsed, exchangeCreditUsed, effectiveTotal } = computeCreditsApplied(
      billComputed.grandTotal,
      appliedStoreCredit,
      exchangeCredit?.amount,
    );
    const isNewBill = !billId;
    const hasInitialPayment = Number(paymentAmount) > 0;
    // What bill_save is sent, for a new bill and for a saved draft alike.
    const partialBill = {
      customerid: selectedCustomerId || null,
      notes: notes || null,
      totalamount: billComputed.grandTotal,
      gst_total: billComputed.gstTotal,
      discount_total: billComputed.itemLevelDiscountTotal + billComputed.overallDiscount + billComputed.balanceDiscount,
      taxable_total: billComputed.taxableTotal,
      net_amount: effectiveTotal,
      final_amount: finalAmount !== "" ? Number(finalAmount) : null,
      ...billStatusFields(BILL_STATUS.PARTIAL),
      applied_codes: selectedCodes,
      payment_amount: Number(paymentAmount),
      store_credit_used: storeCreditUsed,
      exchange_credit_used: exchangeCreditUsed,
      exchange_source_bill: exchangeCredit?.sourceBillNumber || null,
      saleslocationid: salesLocationId || null,
      salesmethodid: hasInitialPayment ? salesMethodId : null,
      orderdate: backdatedDate + "T00:00:00+05:30",
    };
    const partialLines = buildBillItemsPayload(
      null,
      items,
      billComputed.balanceDiscount || 0,
      billComputed.overallDiscount,
      docType,
    );
    const partialSaveFields = {
      salesperson_ids: selectedSalespersonIds,
      skip_stock: isBackdated,
      voucher_id: appliedVoucher?.voucher_id || null,
      exchange_ids: exchangeCredit?.exchangeIds || [],
      // A bill finalized with nothing paid has no ledger row yet: bill_payments.amount must be > 0.
      first_payment: hasInitialPayment
        ? { amount: Number(paymentAmount), salesmethodid: salesMethodId, ...paymentDateFields(firstPaymentDate) }
        : null,
      discount_codes: selectedCodes,
    };
    try {
      if (items.length === 0) {
        toast.error("Add at least one item");
        return;
      }

      const inventoryItems = items.filter((it) => it.variantid);
      let paymentRecord = null;

      if (isNewBill) {
        // ── NEW BILL: absolute stock validation + insert + full stock decrement ──
        let stockMap = {};
        if (inventoryItems.length > 0) {
          const variantIds = inventoryItems.map((it) => it.variantid);
          const { data: stockData, error: stockErr } = await supabase
            .from("productsizecolors")
            .select("variantid, stock, size, color")
            .in("variantid", variantIds);
          if (stockErr) throw new Error("Could not verify stock: " + stockErr.message);
          stockMap = Object.fromEntries(stockData.map((r) => [r.variantid, r]));
          if (!isBackdated) {
            const shortfalls = describeStockShortfalls(inventoryItems, stockMap);
            if (shortfalls) {
              showBlockingError("Insufficient stock", shortfalls);
              return;
            }
          }
        }

        // One bill_save transaction, first payment included
        const bill = await saveBill("partial_create", {
          bill: { ...partialBill, document_type: docType },
          items: partialLines,
          ...partialSaveFields,
        });
        activeBillId = bill.billid;
        newBillRef.current = { id: bill.billid, number: bill.bill_number || `#${bill.billid}` };
        pdfBillNumber = bill.bill_number || null;
        setEffectiveBillNumber(bill.bill_number || null);
        paymentRecord = bill.payment;
      } else {
        // A saved draft is finished by bill_save in one transaction (partial_draft): its lines,
        // stock, voucher, exchange links (only if still unspent), store credit, discount use and
        // the first payment all happen or none do, and only while the draft is as loaded here.
        if (!isBackdated) {
          const stockProblems = await editStockProblems(activeBillId);
          if (stockProblems) {
            showBlockingError("Insufficient stock", stockProblems);
            return;
          }
        }
        const bill = await saveBill("partial_draft", {
          billid: activeBillId,
          expect: openedStateRef.current,
          bill: partialBill,
          items: linesForSavedBill(partialLines),
          ...partialSaveFields,
        });
        paymentRecord = bill.payment;
      }

      // Flush all payment state into InvoiceView before PDF capture
      flushSync(() => {
        setBillPayments(paymentRecord ? [paymentRecord] : []);
        setBillPaymentStatus("partial");
        setEffectiveBillId(activeBillId);
        setStockChoiceLocked(true);
      });
      let pdfUrl = null;
      try {
        pdfUrl = await regenerateBillPdf({ activeBillId, pdfBillNumber });
      } catch (pdfErr) {
        console.error("PDF generation failed:", pdfErr);
        toast.error("PDF generation failed", {
          description: pdfErr?.message || "Bill saved. Reprint from Bill List.",
        });
      }
      if (pdfUrl) window.open(pdfUrl, "_blank");

      const balanceDue = effectiveTotal - Number(paymentAmount);
      toast.success(
        `Bill #${activeBillId} saved — ₹${balanceDue.toFixed(2)} balance due`
      );
      if (isNewBill) {
        logActivity({ action: "create", entityType: "bill", entityId: pdfBillNumber || activeBillId, summary: `Finalized bill (partial) #${pdfBillNumber || "(no number)"} for ${customerName || "walk-in"} — ${money(billComputed.grandTotal)}, ${items.length} items` });
      } else {
        logActivity({ action: "update", entityType: "bill", entityId: effectiveBillNumber || billId, summary: `Finalized bill (partial) #${effectiveBillNumber || "(no number)"} for ${customerName || "walk-in"} — ${money(billComputed.grandTotal)}, ${items.length} items` });
      }
      setPartialConfirmOpen(false);
      onOpenChange?.(false);
      onSubmit?.();
    } catch (e) {
      toast.error(e.message);
      lockIfBillSaved("finishing the bill");
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddPayment = async () => {
    if (saveBlocked) return;
    // Guard against recording a payment (and regenerating the customer-facing PDF) off
    // unsaved item edits: this handler renders the PDF from live in-memory `items`/`computed`
    // state, not from bill_items in the DB. If items were changed here but "Save Draft" was
    // never clicked, the PDF would show items/totals that were never persisted.
    // Compares the edits themselves, not totals: reopening rounds each item's discount to 2 decimals,
    // so an untouched bill's items can add up a few paise away from its stored total.
    if (cleanPricingRef.current !== null && cleanPricingRef.current !== pricingSnapshot) {
      toast.error("Unsaved item changes", {
        description: "Save the bill before recording a payment — item edits haven't been saved yet.",
      });
      return;
    }
    const amt = Number(addPaymentAmount);
    if (!amt || amt <= 0) {
      toast.error("Enter a valid amount");
      return;
    }
    if (!addPaymentMethodId) {
      toast.error("Select a payment method");
      return;
    }
    const addDateProblem = paymentDateProblem(addPaymentDate);
    if (addDateProblem) {
      toast.error(addDateProblem);
      return;
    }
    setIsAddingPayment(true);
    try {
      // The payment, payment_amount and status are one bill_add_payment transaction, judged from
      // every payment on the bill rather than the ones this screen loaded. The key stays while
      // the amount, method and date stay, so pressing again after an unknown outcome replays
      // the first payment instead of recording it twice.
      const attempt = `${billId}|${amt}|${addPaymentMethodId}|${addPaymentDate}`;
      if (addPaymentKeyRef.current?.attempt !== attempt) {
        addPaymentKeyRef.current = { attempt, key: crypto.randomUUID() };
      }
      const { data: result, error: payErr } = await supabase.rpc("bill_add_payment", {
        p_key: addPaymentKeyRef.current.key,
        p_billid: billId,
        p_amount: amt,
        p_salesmethodid: addPaymentMethodId,
        p_recorded_at: paymentDateFields(addPaymentDate).recorded_at ?? null,
      });
      if (payErr) {
        throw new Error(ADD_PAYMENT_ERRORS[payErr.message] || "Failed to record payment: " + payErr.message);
      }
      addPaymentKeyRef.current = null;
      const { payment: newPayment, total_paid: totalPaid, remaining } = result;
      // This window's own payment is not a change made elsewhere: a later save expects it.
      openedStateRef.current = { paymentstatus: result.paymentstatus, payment_amount: totalPaid };
      const isFullyPaid = result.paymentstatus === BILL_STATUS.FINALIZED;

      const updatedPayments = [...billPayments, newPayment].sort(
        (a, b) => new Date(a.recorded_at) - new Date(b.recorded_at),
      );
      setBillPayments(updatedPayments);
      setAddPaymentAmount("");
      setAddPaymentMethodId(null);
      setPaymentAmount(String(totalPaid));
      // A later save writes salesMethodId back to the bill, so keep it in step
      if (billPayments.length === 0) setSalesMethodId(addPaymentMethodId);

      if (isFullyPaid) {
        // Flush finalized state into InvoiceView before PDF capture
        flushSync(() => {
          setBillPaymentStatus("finalized");
          setEffectiveBillId(billId);
        });
        let pdfUrl = null;
        try {
          pdfUrl = await regenerateBillPdf({
            activeBillId: billId,
            pdfBillNumber: effectiveBillNumber,
          });
        } catch (pdfErr) {
          console.error("PDF generation failed:", pdfErr);
          toast.error("PDF generation failed", {
            description: pdfErr?.message || "Reprint from Bill List.",
          });
        }
        if (pdfUrl) window.open(pdfUrl, "_blank");

        toast.success("Bill fully paid — finalized!");
        onSubmit?.();
      } else {
        setBillPaymentStatus("partial");
        toast.success(
          `₹${amt.toFixed(2)} recorded. Balance remaining: ₹${remaining.toFixed(2)}`
        );
      }
      logActivity({ action: "update", entityType: "bill", entityId: effectiveBillNumber || billId, summary: `Recorded payment of ${money(amt)} on bill #${effectiveBillNumber || "(no number)"}${isFullyPaid ? " (now fully paid)" : ""}` });
    } catch (e) {
      toast.error(e.message);
    } finally {
      setIsAddingPayment(false);
    }
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => (next ? onOpenChange?.(true) : requestClose())}
      >
        {/* Closing resets the whole bill, so it takes the X or Cancel, never a stray click or Esc. */}
        <DialogContent
          className="max-w-[95vw] w-full max-h-[90vh] overflow-y-auto bg-white"
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>
              {billId ? `Edit Bill ${effectiveBillNumber || `#${billId}`}` : "New Bill"}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {billId ? "Edit existing bill details" : "Create a new bill"}
            </DialogDescription>
          </DialogHeader>
          <Card className="border-0 shadow-none">
            <CardContent className="space-y-6 p-0 sm:p-2">
              {/* Document type */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">Document:</span>
                <div className="inline-flex rounded-md border overflow-hidden">
                  <button
                    type="button"
                    disabled={docTypeLocked}
                    className={`px-3 py-1 text-sm ${docType === 'bos' ? 'bg-primary text-white' : 'bg-white text-gray-700'} ${docTypeLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
                    onClick={() => setDocType('bos')}
                  >
                    Bill of Supply
                  </button>
                  <button
                    type="button"
                    disabled={docTypeLocked}
                    className={`px-3 py-1 text-sm ${docType === 'invoice' ? 'bg-primary text-white' : 'bg-white text-gray-700'} ${docTypeLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
                    onClick={() => setDocType('invoice')}
                  >
                    Tax Invoice
                  </button>
                </div>
                {docTypeLocked && (
                  <span className="text-xs text-muted-foreground">Locked after creation</span>
                )}
              </div>

              {/* Customer */}
              <section className="grid gap-3">
                <Label htmlFor="bill-customer">Customer</Label>
                <CustomerSelector
                  selectedCustomerId={selectedCustomerId}
                  setSelectedCustomerId={setSelectedCustomerId}
                  displayName={customerDisplayText}
                />
              </section>

              {/* Bill date + stock control */}
              <section className="space-y-2">
                <div className="grid gap-1">
                  <Label htmlFor="bill-date">Bill Date</Label>
                  <Input
                    id="bill-date"
                    type="date"
                    value={backdatedDate}
                    max={todayIST()}
                    onChange={(e) => setBackdatedDate(e.target.value)}
                    className="w-48"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="backdated-bill"
                    checked={isBackdated}
                    onChange={(e) => setIsBackdated(e.target.checked)}
                    disabled={stockChoiceLocked}
                    className="h-4 w-4 cursor-pointer disabled:cursor-not-allowed"
                  />
                  <Label
                    htmlFor="backdated-bill"
                    className="cursor-pointer text-sm font-normal text-muted-foreground"
                  >
                    Don't reduce stock (already corrected by hand for this sale)
                  </Label>
                </div>
              </section>

              {/* Items */}
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Items</Label>
                  <AddItemDialog
                    isBackdated={isBackdated}
                    onAdd={(item) => setItems((prev) => [...prev, item])}
                    salespersons={salespersonsList}
                  />
                </div>
                <ItemTable
                  items={items}
                  setItems={setItems}
                  onEdit={(id) =>
                    setEditingItem(items.find((it) => it._id === id) ?? null)
                  }
                  salespersonMap={salespersonMap}
                  docType={docType}
                  isBackdated={isBackdated}
                  exchangedById={exchangedById}
                />
              </section>

              {/* Edit item dialog — opened programmatically from the pencil icon */}
              {editingItem && (
                <AddItemDialog
                  key={editingItem._id}
                  open={!!editingItem}
                  onOpenChange={(o) => {
                    if (!o) setEditingItem(null);
                  }}
                  isBackdated={isBackdated}
                  editItem={editingItem}
                  salespersons={salespersonsList}
                  onUpdate={(updated) => {
                    setItems((prev) =>
                      prev.map((it) => (it._id === updated._id ? updated : it)),
                    );
                    setEditingItem(null);
                  }}
                />
              )}

              {/* Discounts and voucher: rarely used, so folded away unless one applies */}
              <section className="space-y-3">
                <button
                  type="button"
                  aria-expanded={discountsShown}
                  className="flex w-full items-center justify-between rounded border px-3 py-2 text-sm font-medium hover:bg-gray-50"
                  onClick={() => setDiscountsOpen((prev) => !prev)}
                >
                  <span>Discounts &amp; Voucher</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    {discountStatus === "loading"
                      ? "Loading…"
                      : selectedCodes.length + (appliedVoucher ? 1 : 0) > 0
                        ? `${selectedCodes.length + (appliedVoucher ? 1 : 0)} applied`
                        : "None applied"}
                  </span>
                </button>
                {discountStatus === "failed" && (
                  <div className="flex items-center justify-between gap-2 rounded border border-destructive/40 px-3 py-2 text-sm text-destructive">
                    <span>Discounts did not load.</span>
                    <Button variant="outline" size="sm" onClick={() => setDiscountAttempt((n) => n + 1)}>
                      Retry
                    </Button>
                  </div>
                )}
              <div className={discountsShown ? "space-y-6" : "hidden"}>
              <section className="space-y-2">
                <Label>Overall Discounts</Label>
                <DiscountSelector
                  discounts={visibleDiscounts}
                  selectedCodes={selectedCodes}
                  categoryMap={categoryMap}
                  onToggle={(code) =>
                    setSelectedCodes((prev) =>
                      prev.includes(code)
                        ? prev.filter((c) => c !== code)
                        : [...prev, code],
                    )
                  }
                />
              </section>

              {/* Promotional Voucher */}
              <section className="space-y-2">
                <Label>Promotional Voucher</Label>
                {appliedVoucher ? (
                  <div className="flex justify-between items-center bg-blue-50 border border-blue-200 text-blue-800 rounded px-3 py-1.5 text-sm">
                    <span>
                      Voucher #{appliedVoucher.voucher_id}: ₹
                      {Number(appliedVoucher.value).toFixed(2)} applied
                    </span>
                    <button
                      type="button"
                      className="ml-2 text-blue-600 hover:text-blue-900"
                      aria-label="Remove voucher"
                      onClick={() => {
                        setAppliedVoucher(null);
                        setVoucherError("");
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex gap-2">
                      <Input
                        placeholder="Enter voucher code"
                        value={voucherCode}
                        onChange={(e) => setVoucherCode(e.target.value)}
                        disabled={voucherLoading}
                      />
                      <Button
                        variant="outline"
                        onClick={handleApplyVoucher}
                        disabled={voucherLoading || !voucherCode.trim()}
                      >
                        {voucherLoading ? "Applying..." : "Apply Voucher"}
                      </Button>
                    </div>
                    {voucherError && (
                      <p className="text-xs text-destructive mt-1">
                        {voucherError}
                      </p>
                    )}
                  </>
                )}
              </section>

              </div>
              </section>

              {/* Salesperson(s) */}
              <section className="grid gap-3">
                <SalespersonSelector
                  selectedIds={selectedSalespersonIds}
                  setSelectedIds={setSelectedSalespersonIds}
                />
              </section>

              {/* Notes */}
              <Notes notes={notes} setNotes={setNotes} />

              <BillSlipPhotos billId={effectiveBillId ?? billId} />

              {/* Sale Context */}
              <section className="space-y-2">
                <Label>Sale Details</Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Select
                    value={salesLocationId ? String(salesLocationId) : ""}
                    onValueChange={(v) => setSalesLocationId(Number(v))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Location" />
                    </SelectTrigger>
                    <SelectContent>
                      {salesLocations.map((l) => (
                        <SelectItem
                          key={l.saleslocationid}
                          value={String(l.saleslocationid)}
                        >
                          {l.locationname}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={salesMethodId ? String(salesMethodId) : ""}
                    onValueChange={(v) => setSalesMethodId(Number(v))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Payment method" />
                    </SelectTrigger>
                    <SelectContent>
                      {salesMethods.filter((m) => !isWebsiteMethod(m)).map((m) => (
                        <SelectItem
                          key={m.salesmethodid}
                          value={String(m.salesmethodid)}
                        >
                          {m.methodname}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </section>

              {showPartialButton && (
                <section className="space-y-2">
                  <Label>
                    Final Amount{" "}
                    <span className="text-muted-foreground text-xs font-normal">(optional)</span>
                  </Label>
                  <div className="text-xs text-muted-foreground">
                    Agreed total customer will pay — applies a discount to reduce the bill
                  </div>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">
                      ₹
                    </span>
                    <Input
                      type="number"
                      placeholder="Leave blank for full bill total"
                      className="pl-7"
                      value={finalAmount}
                      onChange={(e) => setFinalAmount(e.target.value)}
                    />
                  </div>
                  {finalAmountDiscountOverLimit && (
                    <div className="rounded bg-yellow-50 border border-yellow-300 text-yellow-800 text-sm px-3 py-2 font-semibold">
                      Warning: This Final Amount gives a discount above 30%.
                    </div>
                  )}
                </section>
              )}

              {/* Payment — show installment history whenever any bill_payments rows exist
                  (a bill flips from "partial" to "finalized" once fully paid, but its
                  payment history must stay visible), otherwise standard single-amount input */}
              {paidInInstallments ? (
                <section className="space-y-3">
                  <PaymentHistory
                    payments={billPayments}
                    netAmount={loadedNetAmount ?? (() => {
                      const { effectiveTotal } = computeCreditsApplied(
                        computed.grandTotal,
                        appliedStoreCredit,
                        exchangeCredit?.amount,
                      );
                      return effectiveTotal;
                    })()}
                  />
                  {billPaymentStatus === "partial" && (
                    <div className="space-y-2">
                      <Label>Record Additional Payment</Label>
                      <div className="flex flex-wrap gap-2">
                        <Input
                          type="date"
                          aria-label="Date payment was received"
                          className="w-40"
                          value={addPaymentDate}
                          min={backdatedDate || undefined}
                          max={todayIST()}
                          onChange={(e) => setAddPaymentDate(e.target.value)}
                        />
                        <div className="relative flex-1 min-w-[8rem]">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">
                            ₹
                          </span>
                          <Input
                            type="number"
                            placeholder="Amount"
                            className="pl-7"
                            value={addPaymentAmount}
                            onChange={(e) => setAddPaymentAmount(e.target.value)}
                          />
                        </div>
                        <Select
                          value={addPaymentMethodId ? String(addPaymentMethodId) : ""}
                          onValueChange={(v) => setAddPaymentMethodId(Number(v))}
                        >
                          <SelectTrigger className="w-40">
                            <SelectValue placeholder="Method" />
                          </SelectTrigger>
                          <SelectContent>
                            {salesMethods.filter((m) => !isWebsiteMethod(m)).map((m) => (
                              <SelectItem key={m.salesmethodid} value={String(m.salesmethodid)}>
                                {m.methodname}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          disabled={isAddingPayment || saveBlocked}
                          onClick={handleAddPayment}
                        >
                          {isAddingPayment ? "Saving..." : "Record"}
                        </Button>
                      </div>
                    </div>
                  )}
                </section>
              ) : (
                <section className="space-y-2">
                  <Label>Payment Amount</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">
                      ₹
                    </span>
                    <Input
                      type="number"
                      placeholder="Amount received"
                      className="pl-7"
                      value={paymentAmount}
                      onChange={(e) => setPaymentAmount(e.target.value)}
                    />
                  </div>
                </section>
              )}

              {/* Apply pending exchange credit (deferred redemption) */}
              {availableExchangeCredit && !exchangeCredit && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    className="text-xs text-purple-700 hover:text-purple-900 underline"
                    onClick={() => setExchangeCredit({
                      amount: availableExchangeCredit.amount,
                      label: availableExchangeCredit.label,
                      exchangeIds: availableExchangeCredit.exchangeIds,
                      items: availableExchangeCredit.items,
                    })}
                  >
                    Apply exchange credit (₹{availableExchangeCredit.amount.toFixed(2)})
                  </button>
                </div>
              )}

              {/* Summary — a finalized bill's routine "Save Draft" edit no longer force-fits the
                  total to the (possibly stale) finalAmount, so show the honest `computed` total
                  here to match what will actually be saved (see handleSaveDraft) */}
              <Summary
                docType={docType}
                computed={shownComputed}
                appliedStoreCredit={appliedStoreCredit}
                appliedVoucher={appliedVoucher}
                customerStoreCreditBalance={customerStoreCreditBalance}
                onRemoveStoreCredit={() => setAppliedStoreCredit(0)}
                onApplyStoreCredit={() =>
                  setAppliedStoreCredit(customerStoreCreditBalance)
                }
                onRemoveVoucher={() => setAppliedVoucher(null)}
                exchangeCredit={exchangeCredit}
                onRemoveExchangeCredit={availableExchangeCredit ? () => setExchangeCredit(null) : undefined}
                exchangeBalanceMode={exchangeBalanceMode}
                onSetExchangeBalanceMode={setExchangeBalanceMode}
                exchangeBalanceAcknowledged={exchangeBalanceAcknowledged}
                onAcknowledgeExchangeBalance={() => setExchangeBalanceAcknowledged(true)}
              />

              {shownError && (
                <div role="alert" className="mt-3 whitespace-pre-line rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
                  <p className="font-semibold">{shownError.title}</p>
                  <p>{shownError.description}</p>
                </div>
              )}
              {/* Actions stay in view, with the total, however far the form is scrolled */}
              <div className="sticky -bottom-6 z-10 -mx-2 flex flex-wrap items-center justify-end gap-2 border-t bg-white px-2 pt-3 pb-6">
                <div className="mr-auto min-w-0 text-sm">
                  <span className="font-semibold tabular-nums">
                    Total {billMoney(shownComputed.grandTotal)}
                  </span>
                  {saveBlockedReason && (
                    <span className="ml-2 text-xs text-muted-foreground" aria-live="polite">
                      {saveBlockedReason}
                    </span>
                  )}
                </div>
                <Button variant="outline" onClick={requestClose}>
                  Cancel
                </Button>
                <Button disabled={isSaving || saveBlocked} onClick={() => handleSaveDraft()}>
                  {isSaving ? "Saving..." : isFinalizedBill ? "Save Changes" : "Save Draft"}
                </Button>
                {showPartialButton && (
                  <Button
                    variant="outline"
                    disabled={isSaving || saveBlocked}
                    onClick={openPartialFinalizeConfirm}
                    className="border-amber-500 text-amber-700 hover:bg-amber-50"
                  >
                    {isSaving ? "Saving..." : "Partial Payment"}
                  </Button>
                )}
                {!paidInInstallments && !billCancelled && (
                  <Button disabled={isSaving || saveBlocked} onClick={openFinalizeConfirm}>
                    {isSaving ? "Saving..." : "Finalize"}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </DialogContent>
      </Dialog>

      {/* Off-screen InvoiceView for html2canvas PDF capture */}
      {open && (
        <div
          style={{
            position: "fixed",
            top: "-9999px",
            left: "-9999px",
            pointerEvents: "none",
          }}
          aria-hidden="true"
        >
          <InvoiceView
            ref={invoiceRef}
            docType={docType}
            billId={effectiveBillId ?? billId}
            billNumber={effectiveBillNumber}
            billDate={backdatedDate}
            customerName={customerName}
            salespersonNames={salespersonNames}
            items={items}
            computed={balanceAdjustedComputed}
            paymentMethod={
              salesMethods.find((m) => m.salesmethodid === salesMethodId)
                ?.methodname || ""
            }
            paymentAmount={paymentAmount}
            appliedCodes={selectedCodes}
            allDiscounts={allDiscounts}
            appliedVoucher={appliedVoucher}
            appliedStoreCredit={appliedStoreCredit}
            exchangeCredit={exchangeCredit}
            exchangeCashRefund={exchangeBalanceMode === "cash_refund" ? exchangeBalance : 0}
            billPayments={billPayments}
            paymentStatus={billPaymentStatus}
          />
        </div>
      )}

      {/* Finalize Confirmation Dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="bg-white max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm Finalize</DialogTitle>
            <DialogDescription>This action cannot be undone.</DialogDescription>
          </DialogHeader>
          {items.some((it) => Number(it.quickDiscountPct || 0) > 30) && (
            <div className="rounded bg-yellow-50 border border-yellow-300 text-yellow-800 text-sm px-3 py-2 space-y-2">
              <p className="font-semibold">
                Warning: One or more items have a discount above 30%.
              </p>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={discountWarningAcked}
                  onChange={(e) => setDiscountWarningAcked(e.target.checked)}
                  className="h-4 w-4"
                />
                I confirm this discount has been approved.
              </label>
            </div>
          )}
          <div className="space-y-2 text-sm">
            <div>
              <span className="font-semibold">Bill #:</span> {billId ?? "(new)"}
            </div>
            <div>
              <span className="font-semibold">Customer:</span>{" "}
              {customerName || "—"}
            </div>
            <div>
              <span className="font-semibold">Grand Total:</span> ₹
              {balanceAdjustedComputed.grandTotal.toFixed(2)}
            </div>
            {balanceAdjustedComputed.balanceDiscount > 0 && (
              <div>
                <span className="font-semibold">
                  Balance Discount (pre-tax):
                </span>{" "}
                −₹{balanceAdjustedComputed.balanceDiscount.toFixed(2)}
              </div>
            )}
            {Number(appliedStoreCredit || 0) > 0 && (
              <div>
                <span className="font-semibold">Paid via Store Credit:</span> −₹
                {Math.min(
                  Number(appliedStoreCredit || 0),
                  balanceAdjustedComputed.grandTotal,
                ).toFixed(2)}
              </div>
            )}
            {Number(exchangeCredit?.amount || 0) > 0 && (
              <div>
                <span className="font-semibold">
                  Applied: {exchangeCredit.label}:
                </span>{" "}
                −₹
                {Math.min(
                  Number(exchangeCredit.amount),
                  Math.max(
                    0,
                    balanceAdjustedComputed.grandTotal -
                      Math.min(
                        Number(appliedStoreCredit || 0),
                        balanceAdjustedComputed.grandTotal,
                      ),
                  ),
                ).toFixed(2)}
              </div>
            )}
            {Number(appliedStoreCredit || 0) > 0 && (
              <div>
                <span className="font-semibold">Net Payable:</span> ₹
                {Math.max(
                  0,
                  balanceAdjustedComputed.grandTotal -
                    Math.min(
                      Number(appliedStoreCredit || 0),
                      balanceAdjustedComputed.grandTotal,
                    ),
                ).toFixed(2)}
              </div>
            )}
            <div>
              <span className="font-semibold">Payment Method:</span>{" "}
              {salesMethods.find((m) => m.salesmethodid === salesMethodId)
                ?.methodname || ""}
            </div>
            <div>
              <span className="font-semibold">Amount Received:</span> ₹
              {Number(paymentAmount).toFixed(2)}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button
              variant="ghost"
              disabled={isSaving}
              onClick={() => setConfirmOpen(false)}
            >
              Keep Editing
            </Button>
            <Button
              disabled={
                isSaving ||
                (items.some((it) => Number(it.quickDiscountPct || 0) > 30) &&
                  !discountWarningAcked)
              }
              onClick={handleConfirmFinalize}
            >
              {isSaving ? "Saving..." : "Confirm & Finalize"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Partial Payment Confirmation Dialog */}
      <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <DialogContent className="bg-white max-w-md">
          <DialogHeader>
            <DialogTitle>Discard Unsaved Changes?</DialogTitle>
            <DialogDescription>Changes to this bill since it was opened will be lost.</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDiscardOpen(false)}>
              Keep Editing
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setDiscardOpen(false);
                onOpenChange?.(false);
              }}
            >
              Discard Changes
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Owner rule 2026-11-12: money an edit leaves over is given back, as store credit (the
          usual choice) or cash. A walk-in bill has no one to credit, so nothing is picked for it. */}
      <Dialog open={!!excessPrompt} onOpenChange={(o) => !o && setExcessPrompt(null)}>
        <DialogContent className="bg-white max-w-md">
          <DialogHeader>
            <DialogTitle>Give back {excessPrompt ? billMoney(excessPrompt.amount) : ""}</DialogTitle>
            <DialogDescription>
              The customer has paid {excessPrompt ? billMoney(excessPrompt.amount) : ""} more than the new bill total.
              Choose how they get it back.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <label className={`flex items-center gap-2 ${selectedCustomerId ? "cursor-pointer" : "opacity-60"}`}>
              <input
                type="radio"
                name="excessMode"
                value="store_credit"
                disabled={!selectedCustomerId}
                checked={excessMode === "store_credit"}
                onChange={() => setExcessMode("store_credit")}
              />
              Add to {customerName ? `${customerName}'s` : "the customer's"} store credit
            </label>
            {!selectedCustomerId && (
              <p className="text-xs text-muted-foreground">
                Walk-in bill: add the customer to the bill first to give store credit.
              </p>
            )}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="excessMode"
                value="refund"
                checked={excessMode === "refund"}
                onChange={() => setExcessMode("refund")}
              />
              Cash refund
            </label>
            {excessMode === "refund" && (
              <Select
                value={excessMethodId ? String(excessMethodId) : ""}
                onValueChange={(v) => setExcessMethodId(Number(v))}
              >
                <SelectTrigger className="w-40" aria-label="Refund method">
                  <SelectValue placeholder="Method" />
                </SelectTrigger>
                <SelectContent>
                  {salesMethods.filter((m) => !isWebsiteMethod(m)).map((m) => (
                    <SelectItem key={m.salesmethodid} value={String(m.salesmethodid)}>
                      {m.methodname}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="ghost" disabled={isSaving} onClick={() => setExcessPrompt(null)}>
              Keep Editing
            </Button>
            <Button
              disabled={isSaving || !excessMode || (excessMode === "refund" && !excessMethodId)}
              onClick={() => {
                const settlement = {
                  mode: excessMode,
                  amount: excessPrompt.amount,
                  ...(excessMode === "refund" ? { salesmethodid: excessMethodId } : {}),
                };
                setExcessPrompt(null);
                handleSaveDraft(settlement);
              }}
            >
              Save and give back
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={partialConfirmOpen} onOpenChange={setPartialConfirmOpen}>
        <DialogContent className="bg-white max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm Partial Payment</DialogTitle>
            <DialogDescription>
              Bill will be finalized with partial payment. Goods are held until paid in full.
            </DialogDescription>
          </DialogHeader>
          {items.some((it) => Number(it.quickDiscountPct || 0) > 30) && (
            <div className="rounded bg-yellow-50 border border-yellow-300 text-yellow-800 text-sm px-3 py-2 space-y-2">
              <p className="font-semibold">Warning: One or more items have a discount above 30%.</p>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={discountWarningAcked}
                  onChange={(e) => setDiscountWarningAcked(e.target.checked)}
                  className="h-4 w-4"
                />
                I confirm this discount has been approved.
              </label>
            </div>
          )}
          <div className="space-y-2 text-sm">
            <div><span className="font-semibold">Bill #:</span> {billId ?? "(new)"}</div>
            <div><span className="font-semibold">Customer:</span> {customerName || "—"}</div>
            {Number(paymentAmount) > 0 && (
              <div className="grid gap-1">
                <Label htmlFor="first-payment-date">Date this payment was received</Label>
                <Input
                  id="first-payment-date"
                  type="date"
                  className="w-48"
                  value={firstPaymentDate}
                  min={backdatedDate || undefined}
                  max={todayIST()}
                  onChange={(e) => setFirstPaymentDate(e.target.value)}
                />
              </div>
            )}
            <div>
              <span className="font-semibold">Grand Total:</span>{" "}
              ₹{balanceAdjustedComputed.grandTotal.toFixed(2)}
            </div>
            <div>
              <span className="font-semibold">Amount Received Now:</span>{" "}
              ₹{Number(paymentAmount).toFixed(2)}
            </div>
            {Number(finalAmount) > 0 && (
              <div>
                <span className="font-semibold">Agreed Final Amount:</span>{" "}
                ₹{Number(finalAmount).toFixed(2)}
              </div>
            )}
            <div className="font-bold text-red-600">
              <span className="font-semibold">Balance Due on Pickup:</span>{" "}
              ₹{Math.max(0, (() => {
                const { effectiveTotal } = computeCreditsApplied(
                  balanceAdjustedComputed.grandTotal,
                  appliedStoreCredit,
                  exchangeCredit?.amount,
                );
                return effectiveTotal - Number(paymentAmount);
              })()).toFixed(2)}
            </div>
            <div className="rounded bg-red-50 border border-red-300 text-red-700 text-xs px-3 py-2 font-semibold text-center">
              ⚠ GOODS WILL NOT BE RELEASED UNTIL PAYMENT IN FULL
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button
              variant="ghost"
              disabled={isSaving}
              onClick={() => setPartialConfirmOpen(false)}
            >
              Keep Editing
            </Button>
            <Button
              disabled={
                isSaving ||
                (items.some((it) => Number(it.quickDiscountPct || 0) > 30) &&
                  !discountWarningAcked)
              }
              onClick={handleConfirmPartialFinalize}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {isSaving ? "Saving..." : "Confirm Partial Payment"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
