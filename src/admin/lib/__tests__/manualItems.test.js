import {
  findManualItems,
  nextManualItemId,
  createManualItem,
  ManualItemInputError,
} from "../manualItems";
import { fakeSupabase } from "../testing/fakeSupabase";

const oct2026 = () => new Date("2026-10-31T10:00:00+05:30");

describe("findManualItems", () => {
  it("applies code, name and in-stock filters and adds the cost Z-code", async () => {
    const row = { manual_item_id: "BCX26125", name: "Dupatta", purchase_price: "200.00", stock: 1 };
    const client = fakeSupabase({ "manual_items.select": { data: [row], error: null } });
    const out = await findManualItems(client, { code: "bcx26125", name: "dup", inStock: true });
    expect(out).toEqual([{ ...row, cost_zcode: "ZBZZ" }]);
    expect(client.calls[0].filters).toEqual([
      ["eq", "manual_item_id", "BCX26125"],
      ["ilike", "name", "%dup%"],
      ["gt", "stock", 0],
    ]);
  });

  it("requires a code or a name", async () => {
    await expect(findManualItems(fakeSupabase(), {})).rejects.toThrow(ManualItemInputError);
  });
});

describe("nextManualItemId", () => {
  it("increments the current year's highest suffix", async () => {
    const client = fakeSupabase({ "rpc.get_max_manual_item_suffix": { data: 26128, error: null } });
    await expect(nextManualItemId(client, oct2026())).resolves.toBe("BCX26129");
    expect(client.calls[0].args).toEqual({ p_prefix: "BCX26" });
  });

  it("starts at 001 when the year has no items", async () => {
    const client = fakeSupabase({ "rpc.get_max_manual_item_suffix": { data: null, error: null } });
    await expect(nextManualItemId(client, oct2026())).resolves.toBe("BCX26001");
  });
});

describe("createManualItem", () => {
  const input = { name: " Fall ", categoryid: "ACC", mrp: "150", cost: "ZEZ" };
  const ok = {
    "categories.select": { data: { categoryid: "ACC" }, error: null },
    "rpc.get_max_manual_item_suffix": { data: 26128, error: null },
  };

  it("dry run shows the row with next id and decoded cost, writes nothing", async () => {
    const client = fakeSupabase(ok);
    const out = await createManualItem(client, input, { dryRun: true, now: oct2026 });
    expect(out).toEqual({
      dry_run: true,
      would_insert: {
        manual_item_id: "BCX26129",
        name: "Fall",
        categoryid: "ACC",
        size: null,
        color: null,
        purchase_price: 50,
        mrp: 150,
      },
    });
    expect(client.calls.some((c) => c.op === "insert")).toBe(false);
  });

  it("inserts and returns the saved row", async () => {
    const client = fakeSupabase({
      ...ok,
      "manual_items.insert": (call) => ({ data: { ...call.row, stock: 1 }, error: null }),
    });
    const saved = await createManualItem(client, { ...input, cost: "50" }, { now: oct2026 });
    expect(saved).toMatchObject({ manual_item_id: "BCX26129", purchase_price: 50, stock: 1, cost_zcode: "ZEZ" });
  });

  it.each([
    [{ ...input, name: "" }, /name is required/i],
    [{ ...input, categoryid: "" }, /category is required/i],
    [{ ...input, mrp: "abc" }, /invalid mrp/i],
    [{ ...input, mrp: undefined }, /invalid mrp/i],
    [{ ...input, cost: "" }, /valid cost is required/i],
    [{ ...input, cost: "ZZ" }, /valid cost is required/i],
  ])("rejects bad input %#", async (bad, msg) => {
    await expect(createManualItem(fakeSupabase(ok), bad, { now: oct2026 })).rejects.toThrow(msg);
  });

  it("rejects an unknown category", async () => {
    const client = fakeSupabase({ ...ok, "categories.select": { data: null, error: null } });
    await expect(createManualItem(client, input, { now: oct2026 })).rejects.toThrow(/Unknown category "ACC"/);
  });
});
