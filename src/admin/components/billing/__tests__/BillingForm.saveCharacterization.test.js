import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import BillingForm from "../BillingForm";
import { clearBillingLookups } from "../billingLookups";
import { todayIST } from "../../../../utility/dateFormat";

// Step 0 of the transactional bill save work: every test here pins what BillingForm
// writes TODAY, in order, for one scenario. The snapshots (committed beside this file)
// are the record. They include known flaws; do not "fix" a snapshot to match a better
// behaviour. When a save path changes on purpose, the snapshot diff is the review.
//
// Write = any insert / update / delete / rpc / storage call / activity-log entry.
// Reads are not recorded. CRA's jest config sets resetMocks: true, so state lives in
// plain objects reset in beforeEach.

const mockDb = {
  writes: [],
  customerCredit: 0,
  voucherRow: null,
  discounts: [],
  bill: null, // row returned when an existing bill is opened or re-read
  existingItems: [], // bill_items rows the save reads to work out the stock difference
  alterationCharge: 0,
};

const CASH = 1;
const UPI = 2;

const mockResolve = (s) => {
  if (s.op === "insert" && s.table === "bills") {
    return { data: { billid: 42, bill_number: "FY26-SG0042" }, error: null };
  }
  if (s.op === "insert" && s.table === "bill_payments") {
    return {
      data: { payment_id: 900, amount: s.payload.amount, salesmethodid: s.payload.salesmethodid, recorded_at: s.payload.recorded_at || "2026-01-01T00:00:00" },
      error: null,
    };
  }
  if (s.op !== "select") return { data: null, error: null };
  switch (s.table) {
    case "customers":
      return {
        data: { first_name: "Asha", last_name: "", phone: "999", store_credit: mockDb.customerCredit },
        error: null,
      };
    case "productsizecolors":
      return { data: [{ variantid: "v1", stock: 5, size: "M", color: "Red" }], error: null };
    case "vouchers":
      return { data: mockDb.voucherRow, error: null };
    case "discounts":
      return { data: mockDb.discounts, error: null };
    case "bills":
      return { data: mockDb.bill, error: null };
    case "bill_items":
      return { data: mockDb.existingItems, error: null };
    case "salesmethods":
      return { data: [{ salesmethodid: CASH, methodname: "Cash" }, { salesmethodid: UPI, methodname: "UPI" }], error: null };
    case "saleslocations":
      return { data: [{ saleslocationid: 1, locationname: "Shop" }], error: null };
    default:
      return { data: s.single ? null : [], error: null };
  }
};

const mockChain = (table) => {
  const s = { table, op: "select", payload: undefined, filters: [] };
  const run = () => {
    if (s.op !== "select") {
      mockDb.writes.push({
        kind: "table",
        table,
        op: s.op,
        ...(s.payload !== undefined ? { payload: s.payload } : {}),
        filters: s.filters,
      });
    }
    return Promise.resolve(mockResolve(s));
  };
  const chain = {
    select: () => chain,
    insert: (p) => { s.op = "insert"; s.payload = p; return chain; },
    update: (p) => { s.op = "update"; s.payload = p; return chain; },
    delete: () => { s.op = "delete"; return chain; },
    eq: (c, v) => { s.filters.push(["eq", c, v]); return chain; },
    in: (c, v) => { s.filters.push(["in", c, v]); return chain; },
    is: () => chain,
    not: () => chain,
    or: () => chain,
    order: () => chain,
    limit: () => chain,
    single: () => { s.single = true; return run(); },
    maybeSingle: () => { s.single = true; return run(); },
    then: (res, rej) => run().then(res, rej),
  };
  return chain;
};

jest.mock("../../../../lib/supabaseClient", () => ({
  supabase: {
    from: (table) => mockChain(table),
    rpc: (fn, args) => {
      mockDb.writes.push({ kind: "rpc", fn, args });
      return Promise.resolve(
        fn === "voucher_redeem" ? { data: true, error: null } : { data: 0, error: null },
      );
    },
    storage: {
      from: (bucket) => ({
        remove: (paths) => {
          mockDb.writes.push({ kind: "storage", bucket, op: "remove", paths });
          return Promise.resolve({ error: null });
        },
        upload: (path) => {
          mockDb.writes.push({ kind: "storage", bucket, op: "upload", path });
          return Promise.resolve({ error: null });
        },
        createSignedUrl: () => Promise.resolve({ data: { signedUrl: null } }),
      }),
    },
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));

jest.mock("sonner", () => ({
  toast: { success: () => {}, error: () => {}, warning: () => {} },
}));

jest.mock("../../../../lib/activityLog", () => ({
  logActivity: (entry) => mockDb.writes.push({ kind: "activity_log", entry }),
}));
jest.mock("../generateInvoicePdf", () => ({
  generateInvoicePdf: () => Promise.resolve(new Blob(["pdf"])),
}));

// Radix Select cannot be driven in jsdom: render every option as a button instead.
jest.mock("../../../../components/ui/select", () => {
  const React = require("react");
  const OnChange = React.createContext(null);
  return {
    Select: ({ onValueChange, children }) => (
      <OnChange.Provider value={onValueChange}>
        <div>{children}</div>
      </OnChange.Provider>
    ),
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }) => <div>{children}</div>,
    SelectItem: ({ value, children }) => {
      const onValueChange = React.useContext(OnChange);
      return (
        <button type="button" onClick={() => onValueChange?.(value)}>
          {children}
        </button>
      );
    },
  };
});

// Stand-in for the inventory picker: one click adds 2 units of variant v1 @ ₹150.
jest.mock("../AddItemDialog", () => (props) =>
  props.editItem ? null : (
    <button
      type="button"
      onClick={() =>
        props.onAdd({
          _id: "row1",
          source: "inventory",
          variantid: "v1",
          productid: "BC25001",
          product_name: "Kurti",
          quantity: 2,
          unit_type: "piece",
          mrp: 150,
          alteration_charge: mockDb.alterationCharge,
          quickDiscountPct: 0,
          gstRate: 5,
          stitchType: "unstitched",
          size: "M",
          color: "Red",
        })
      }
    >
      Stub add item
    </button>
  ),
);

const TEN_PERCENT = {
  id: 1, code: "TEN", type: "percentage", value: 10, auto_apply: true, active: true,
  once_per_customer: false, exclusive: false, rules: {},
};

// An opened bill: 2 × Kurti @ ₹150, nothing received yet beyond what a test sets.
const storedBill = (overrides = {}) => ({
  billid: 330,
  bill_number: "FY26-SG0330",
  orderdate: "2026-09-30T00:00:00",
  customerid: 7,
  customers: { first_name: "Asha", last_name: "", phone: "999", store_credit: 0, discount_usage: [], exchanges: [] },
  document_type: "bos",
  paymentstatus: "draft",
  finalized: false,
  totalamount: 300,
  net_amount: null,
  final_amount: null,
  payment_amount: 300,
  salesmethodid: CASH,
  saleslocationid: 1,
  store_credit_used: 0,
  applied_codes: [],
  notes: null,
  bill_payments: [],
  bill_salespersons: [],
  linked_exchanges: [],
  bill_items: [
    {
      bill_item_id: 11, variantid: "v1", product_code: "BC25001", product_name: "Kurti",
      quantity: 2, unit_type: "piece", mrp: 150, discount_total: 0, total: 300,
      gst_rate: 5, stitch_type: "unstitched", alteration_charge: 0,
      productsizecolors: { size: "M", color: "Red" },
    },
  ],
  ...overrides,
});

beforeEach(() => {
  mockDb.writes = [];
  mockDb.customerCredit = 0;
  mockDb.voucherRow = null;
  mockDb.discounts = [];
  mockDb.bill = null;
  mockDb.existingItems = [];
  mockDb.alterationCharge = 0;
  clearBillingLookups();
  window.open = () => null;
});

// Today's date and the PDF file's time stamp change on every run; the snapshots must not.
const normalised = () => {
  const today = todayIST();
  return JSON.parse(
    JSON.stringify(mockDb.writes).split(today).join("<today>").replace(/-v\d+\.pdf/g, "-v<time>.pdf"),
  );
};

// "Save Draft" on a draft, "Save Changes" once the bill is finalized.
const SAVE_BUTTON = /^Save (Draft|Changes)$/;
const click = (name) => fireEvent.click(screen.getByRole("button", { name }));
const clickLast = (name) => fireEvent.click(screen.getAllByRole("button", { name }).slice(-1)[0]);

async function openNew({ onSubmit } = {}) {
  render(<BillingForm open onOpenChange={() => {}} onSubmit={onSubmit} prefilledCustomerId={7} />);
  fireEvent.click(screen.getByRole("button", { name: "Stub add item" }));
  await screen.findAllByText("Kurti");
  await waitFor(() => expect(screen.getByRole("button", { name: "Save Draft" })).toBeEnabled());
  if (mockDb.customerCredit > 0) await screen.findAllByText(/Store Credit/);
}

async function openExisting(bill, { onSubmit } = {}) {
  mockDb.bill = bill;
  render(<BillingForm billId={330} open onOpenChange={() => {}} onSubmit={onSubmit} />);
  await screen.findAllByText("Kurti");
  await waitFor(() => expect(screen.getByRole("button", { name: SAVE_BUTTON })).toBeEnabled());
}

const setPayment = (amount, method) => {
  fireEvent.change(screen.getByPlaceholderText("Amount received"), { target: { value: String(amount) } });
  click(method);
};

const done = (onSubmit) => waitFor(() => expect(onSubmit).toHaveBeenCalled());

async function finalize(onSubmit) {
  click("Finalize");
  fireEvent.click(await screen.findByRole("button", { name: "Confirm & Finalize" }));
  await done(onSubmit);
}

async function partialFinalize(onSubmit) {
  click("Partial Payment");
  fireEvent.click(await screen.findByRole("button", { name: "Confirm Partial Payment" }));
  await done(onSubmit);
}

async function saveDraft(onSubmit) {
  click(SAVE_BUTTON);
  await done(onSubmit);
}

const setDate = (value) =>
  fireEvent.change(screen.getByLabelText("Bill Date"), { target: { value } });
const tickDontReduceStock = () => fireEvent.click(screen.getByLabelText(/Don't reduce stock/));

// ---- Path A: new draft -------------------------------------------------------------

describe("path A, new draft (pins current behaviour)", () => {
  test("pins current behaviour: plain draft", async () => {
    const onSubmit = jest.fn();
    await openNew({ onSubmit });
    await saveDraft(onSubmit);
    expect(normalised()).toMatchSnapshot();
  });

  test("pins current behaviour: draft with Don't reduce stock ticked", async () => {
    const onSubmit = jest.fn();
    await openNew({ onSubmit });
    tickDontReduceStock();
    await saveDraft(onSubmit);
    expect(normalised()).toMatchSnapshot();
  });

  test("pins current behaviour: backdated draft on a tax invoice with a code discount", async () => {
    mockDb.discounts = [TEN_PERCENT];
    const onSubmit = jest.fn();
    await openNew({ onSubmit });
    click("Tax Invoice");
    setDate("2026-03-31");
    await saveDraft(onSubmit);
    expect(normalised()).toMatchSnapshot();
  });
});

// ---- Path B: edit draft, and Save Draft on a reopened finalized bill ----------------

describe("path B, edit draft (pins current behaviour)", () => {
  test("pins current behaviour: save an untouched draft with a salesperson", async () => {
    mockDb.existingItems = [{ variantid: "v1", quantity: 2 }];
    const onSubmit = jest.fn();
    await openExisting(
      storedBill({ bill_salespersons: [{ salesperson_id: 3, salespersons: { name: "Sam" } }] }),
      { onSubmit },
    );
    await saveDraft(onSubmit);
    expect(normalised()).toMatchSnapshot();
  });

  test("pins current behaviour: Save Draft on a finalized bill keeps it finalized and moves no stock", async () => {
    mockDb.existingItems = [{ variantid: "v1", quantity: 2 }];
    const onSubmit = jest.fn();
    await openExisting(
      storedBill({ finalized: true, paymentstatus: "finalized", store_credit_used: 100, net_amount: 200 }),
      { onSubmit },
    );
    await saveDraft(onSubmit);
    expect(normalised()).toMatchSnapshot();
  });
});

// ---- Path C: finalize a new bill -----------------------------------------------------

describe("path C, finalize new (pins current behaviour)", () => {
  test("pins current behaviour: plain bill paid by cash", async () => {
    const onSubmit = jest.fn();
    await openNew({ onSubmit });
    setPayment(300, "Cash");
    await finalize(onSubmit);
    expect(normalised()).toMatchSnapshot();
  });

  test("pins current behaviour: tax invoice paid by UPI", async () => {
    const onSubmit = jest.fn();
    await openNew({ onSubmit });
    click("Tax Invoice");
    await waitFor(() => expect(screen.getByText("GST")).toBeInTheDocument());
    setPayment(300, "UPI");
    await finalize(onSubmit);
    expect(normalised()).toMatchSnapshot();
  });

  test("pins current behaviour: code discount writes a discount_usage row", async () => {
    mockDb.discounts = [TEN_PERCENT];
    const onSubmit = jest.fn();
    await openNew({ onSubmit });
    setPayment(270, "Cash");
    await finalize(onSubmit);
    expect(normalised()).toMatchSnapshot();
  });

  test("pins current behaviour: voucher is redeemed", async () => {
    mockDb.voucherRow = {
      voucher_id: "VOUCH1", customerid: null, expiry_date: "2099-12-31",
      value: 100, redeemed: false, held_order_id: null,
    };
    const onSubmit = jest.fn();
    await openNew({ onSubmit });
    fireEvent.change(screen.getByPlaceholderText("Enter voucher code"), { target: { value: "VOUCH1" } });
    click("Apply Voucher");
    await screen.findAllByText(/Voucher #VOUCH1/);
    setPayment(200, "Cash");
    await finalize(onSubmit);
    expect(normalised()).toMatchSnapshot();
  });

  test("pins current behaviour: store credit above the total covers it, no payment entered", async () => {
    mockDb.customerCredit = 500;
    const onSubmit = jest.fn();
    await openNew({ onSubmit });
    await finalize(onSubmit);
    expect(normalised()).toMatchSnapshot();
  });

  test("pins current behaviour: store credit below the total, rest paid in cash", async () => {
    mockDb.customerCredit = 100;
    const onSubmit = jest.fn();
    await openNew({ onSubmit });
    setPayment(200, "Cash");
    await finalize(onSubmit);
    expect(normalised()).toMatchSnapshot();
  });

  test("pins current behaviour: Don't reduce stock ticked moves no stock", async () => {
    const onSubmit = jest.fn();
    await openNew({ onSubmit });
    tickDontReduceStock();
    setPayment(300, "Cash");
    await finalize(onSubmit);
    expect(normalised()).toMatchSnapshot();
  });

  test.each(["2026-03-31", "2026-04-01"])(
    "pins current behaviour: backdated to %s",
    async (date) => {
      const onSubmit = jest.fn();
      await openNew({ onSubmit });
      setDate(date);
      setPayment(300, "Cash");
      await finalize(onSubmit);
      expect(normalised()).toMatchSnapshot();
    },
  );
});

// ---- Path D: finalize an existing bill -------------------------------------------------

describe("path D, finalize existing (pins current behaviour)", () => {
  test("pins current behaviour: draft to finalized", async () => {
    mockDb.existingItems = [{ variantid: "v1", quantity: 2 }];
    const onSubmit = jest.fn();
    await openExisting(storedBill(), { onSubmit });
    await finalize(onSubmit);
    expect(normalised()).toMatchSnapshot();
  });

  test("pins current behaviour: draft to finalized with a voucher", async () => {
    mockDb.existingItems = [{ variantid: "v1", quantity: 2 }];
    mockDb.voucherRow = {
      voucher_id: "VOUCH1", customerid: null, expiry_date: "2099-12-31",
      value: 100, redeemed: false, held_order_id: null,
    };
    const onSubmit = jest.fn();
    await openExisting(storedBill({ payment_amount: 200 }), { onSubmit });
    fireEvent.change(screen.getByPlaceholderText("Enter voucher code"), { target: { value: "VOUCH1" } });
    click("Apply Voucher");
    await screen.findAllByText(/Voucher #VOUCH1/);
    await finalize(onSubmit);
    expect(normalised()).toMatchSnapshot();
  });

  test("pins current behaviour: re-finalize a bill that has a code and store credit", async () => {
    mockDb.discounts = [TEN_PERCENT];
    mockDb.existingItems = [{ variantid: "v1", quantity: 2 }];
    const onSubmit = jest.fn();
    await openExisting(
      storedBill({
        finalized: true, paymentstatus: "finalized", applied_codes: ["TEN"],
        store_credit_used: 100, payment_amount: 170, totalamount: 270,
      }),
      { onSubmit },
    );
    await finalize(onSubmit);
    expect(normalised()).toMatchSnapshot();
  });
});

// ---- Path E: partial finalize, new bill ----------------------------------------------------

describe("path E, partial finalize new (pins current behaviour)", () => {
  test("pins current behaviour: nothing paid", async () => {
    const onSubmit = jest.fn();
    await openNew({ onSubmit });
    await partialFinalize(onSubmit);
    expect(normalised()).toMatchSnapshot();
  });

  test("pins current behaviour: with a deposit", async () => {
    const onSubmit = jest.fn();
    await openNew({ onSubmit });
    setPayment(100, "UPI");
    await partialFinalize(onSubmit);
    expect(normalised()).toMatchSnapshot();
  });

  test("pins current behaviour: with a deposit, Don't reduce stock ticked", async () => {
    const onSubmit = jest.fn();
    await openNew({ onSubmit });
    tickDontReduceStock();
    setPayment(100, "UPI");
    await partialFinalize(onSubmit);
    expect(normalised()).toMatchSnapshot();
  });
});

// ---- Path F: partial finalize, existing draft ------------------------------------------------

describe("path F, partial finalize existing draft (pins current behaviour)", () => {
  test("pins current behaviour: with a deposit and a salesperson", async () => {
    mockDb.existingItems = [{ variantid: "v1", quantity: 2 }];
    const onSubmit = jest.fn();
    await openExisting(
      storedBill({
        payment_amount: 100, salesmethodid: UPI,
        bill_salespersons: [{ salesperson_id: 3, salespersons: { name: "Sam" } }],
      }),
      { onSubmit },
    );
    await partialFinalize(onSubmit);
    expect(normalised()).toMatchSnapshot();
  });

  test("pins current behaviour: nothing paid", async () => {
    mockDb.existingItems = [{ variantid: "v1", quantity: 2 }];
    const onSubmit = jest.fn();
    await openExisting(storedBill({ payment_amount: null, salesmethodid: null }), { onSubmit });
    await partialFinalize(onSubmit);
    expect(normalised()).toMatchSnapshot();
  });
});

// ---- Path G: record a payment on a partial bill ------------------------------------------------

describe("path G, record payment (pins current behaviour)", () => {
  const partialBill = () =>
    storedBill({
      finalized: true, paymentstatus: "partial", net_amount: 300, payment_amount: 100,
      bill_payments: [{ payment_id: 1, amount: 100, salesmethodid: CASH, recorded_at: "2026-09-30T12:00:00" }],
    });

  test("pins current behaviour: payment that leaves a balance", async () => {
    await openExisting(partialBill());
    fireEvent.change(screen.getByPlaceholderText("Amount"), { target: { value: "50" } });
    clickLast("UPI");
    click("Record");
    await waitFor(() => expect(mockDb.writes.some((w) => w.kind === "activity_log")).toBe(true));
    expect(normalised()).toMatchSnapshot();
  });

  test("pins current behaviour: payment that settles the bill", async () => {
    const onSubmit = jest.fn();
    await openExisting(partialBill(), { onSubmit });
    fireEvent.change(screen.getByPlaceholderText("Amount"), { target: { value: "200" } });
    clickLast("Cash");
    click("Record");
    await done(onSubmit);
    expect(normalised()).toMatchSnapshot();
  });
});
