import {
  normalizePhone,
  buildCustomerPayload,
  findCustomerByPhone,
  createCustomer,
  CustomerInputError,
} from "../customers";

// Minimal stand-in for the supabase-js query builder: records each call and
// resolves with the canned result for that table + operation.
function fakeClient(results) {
  const calls = [];
  const from = (table) => {
    const call = { table, op: "select", filters: [], row: null };
    calls.push(call);
    const builder = {
      select: () => builder,
      insert: (row) => {
        call.op = "insert";
        call.row = row;
        return builder;
      },
      eq: (col, val) => {
        call.filters.push([col, val]);
        return builder;
      },
      order: () => builder,
      single: () => builder,
      then: (resolve, reject) =>
        Promise.resolve(results[`${table}.${call.op}`] ?? { data: null, error: null }).then(
          resolve,
          reject,
        ),
    };
    return builder;
  };
  return { from, calls };
}

describe("normalizePhone", () => {
  it("returns null for empty input", () => {
    expect(normalizePhone(undefined)).toBeNull();
    expect(normalizePhone("   ")).toBeNull();
  });
  it("prefixes +91 to a bare 10-digit number and strips spaces", () => {
    expect(normalizePhone("90000 00001")).toBe("+919000000001");
  });
  it("keeps a number that already has a country code", () => {
    expect(normalizePhone("+91 90000 00001")).toBe("+919000000001");
    expect(normalizePhone("+14155550123")).toBe("+14155550123");
  });
  it("rejects anything not matching the form's phone rule", () => {
    expect(() => normalizePhone("12345")).toThrow(CustomerInputError);
    expect(() => normalizePhone("90000-00001")).toThrow(CustomerInputError);
  });
});

describe("buildCustomerPayload", () => {
  it("builds a guest customer when there is no phone", () => {
    const p = buildCustomerPayload({ first_name: "Asha" }, "U1");
    expect(p).toEqual({
      customer_ulid: "U1",
      first_name: "Asha",
      last_name: null,
      phone: null,
      email: null,
      address: null,
      gender: null,
      customer_notes: null,
      loyalty_tier: "bronze",
      store_credit: 0,
      referred_by: null,
      is_guest: true,
    });
  });
  it("normalises phone and marks non-guest", () => {
    const p = buildCustomerPayload(
      { first_name: " Test ", last_name: "Customer", phone: "9000000001" },
      "U2",
    );
    expect(p.first_name).toBe("Test");
    expect(p.phone).toBe("+919000000001");
    expect(p.is_guest).toBe(false);
  });
  it("requires a first name", () => {
    expect(() => buildCustomerPayload({ first_name: " " }, "U3")).toThrow(
      /first name is required/i,
    );
  });
  it("rejects an invalid email", () => {
    expect(() =>
      buildCustomerPayload({ first_name: "A", email: "nope" }, "U4"),
    ).toThrow(/invalid email/i);
  });
});

describe("findCustomerByPhone", () => {
  it("queries by normalised phone and returns the first match", async () => {
    const row = { customerid: 7, phone: "+919000000001" };
    const client = fakeClient({ "customers.select": { data: [row], error: null } });
    await expect(findCustomerByPhone(client, "9000000001")).resolves.toEqual(row);
    expect(client.calls[0].filters).toEqual([["phone", "+919000000001"]]);
  });
  it("returns null when nobody has that phone", async () => {
    const client = fakeClient({ "customers.select": { data: [], error: null } });
    await expect(findCustomerByPhone(client, "9000000001")).resolves.toBeNull();
  });
  it("propagates a database error", async () => {
    const client = fakeClient({
      "customers.select": { data: null, error: new Error("boom") },
    });
    await expect(findCustomerByPhone(client, "9000000001")).rejects.toThrow("boom");
  });
});

describe("createCustomer", () => {
  const input = { first_name: "Test", last_name: "Customer", phone: "9000000001" };

  it("refuses a phone that already belongs to a customer", async () => {
    const client = fakeClient({
      "customers.select": {
        data: [{ customerid: 7, first_name: "Test", last_name: "M", phone: "+919000000001" }],
        error: null,
      },
    });
    await expect(createCustomer(client, input, { newUlid: () => "U" })).rejects.toThrow(
      /already belongs to customer 7 \(Test M\)/,
    );
    expect(client.calls.some((c) => c.op === "insert")).toBe(false);
  });

  it("dry run returns the payload and writes nothing", async () => {
    const client = fakeClient({ "customers.select": { data: [], error: null } });
    const out = await createCustomer(client, input, { dryRun: true, newUlid: () => "U" });
    expect(out).toEqual({
      dry_run: true,
      would_insert: expect.objectContaining({ customer_ulid: "U", phone: "+919000000001" }),
    });
    expect(client.calls.some((c) => c.op === "insert")).toBe(false);
  });

  it("inserts the customer and logs the activity", async () => {
    const saved = { customerid: 9, first_name: "Test", last_name: "Customer", phone: "+919000000001" };
    const client = fakeClient({
      "customers.select": { data: [], error: null },
      "customers.insert": { data: saved, error: null },
      "activity_log.insert": { data: null, error: null },
    });
    await expect(createCustomer(client, input, { newUlid: () => "U" })).resolves.toEqual(saved);
    const log = client.calls.find((c) => c.table === "activity_log");
    expect(log.row).toEqual({
      actor_id: null,
      action: "create",
      entity_type: "customer",
      entity_id: "9",
      summary: "Added customer Test Customer (+919000000001) (via CLI)",
    });
  });

  it("skips the duplicate check for a guest", async () => {
    const saved = { customerid: 10, first_name: "Walk", last_name: null, phone: null };
    const client = fakeClient({
      "customers.insert": { data: saved, error: null },
      "activity_log.insert": { data: null, error: null },
    });
    await createCustomer(client, { first_name: "Walk" }, { newUlid: () => "U" });
    expect(client.calls[0].op).toBe("insert");
  });

  it("returns the saved customer even if the activity log write fails", async () => {
    const saved = { customerid: 11, first_name: "A", last_name: null, phone: null };
    const client = fakeClient({
      "customers.insert": { data: saved, error: null },
      "activity_log.insert": { data: null, error: new Error("log down") },
    });
    const warn = jest.spyOn(console, "error").mockImplementation(() => {});
    await expect(createCustomer(client, { first_name: "A" }, { newUlid: () => "U" })).resolves.toEqual(saved);
    expect(warn).toHaveBeenCalledWith("[activityLog] insert failed:", "log down");
    warn.mockRestore();
  });
});
