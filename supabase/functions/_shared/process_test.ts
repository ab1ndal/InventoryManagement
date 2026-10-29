import { assert, assertEquals, assertRejects } from "@std/assert";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildSrInput,
  CourierError,
  createLines,
  ensureSrOrder,
  runProcess,
  runRebook,
  runSendBack,
  shippableDiffers,
} from "./process.ts";
import { FakeDb, fakeItems, fakeOrder, FakeShiprocket, FULL_PLAN, ITEM_A, ITEM_B, ORDER_ID } from "./process_fakes.ts";
import { handle } from "./jobs/shiprocket_create.ts";
import type { JobContext } from "./jobs/types.ts";
import type { SrOrderInput } from "./shiprocket.ts";

const SHOP = "shop@example.com";

Deno.test("buildSrInput: bare ref on first attempt, -n suffix from attempt 2", () => {
  const lines = createLines(fakeItems());
  assertEquals(buildSrInput(fakeOrder(), lines).orderRef, "WEB-000123");
  assertEquals(buildSrInput(fakeOrder({ sr_attempt: 1 }), lines).orderRef, "WEB-000123");
  assertEquals(buildSrInput(fakeOrder({ sr_attempt: 2 }), lines).orderRef, "WEB-000123-2");
});

Deno.test("buildSrInput: paid values, sub_total, package dims, weight by category per unit", () => {
  const input = buildSrInput(fakeOrder(), createLines(fakeItems()));
  assertEquals(input.orderRef, "WEB-000123");
  assertEquals(input.items, [
    { name: "Lehenga / M / Red", sku: "BC25001-M-Red", units: 1, sellingPrice: 3000 },
    { name: "Kurti / L / Blue", sku: "BC25002-L-Blue", units: 2, sellingPrice: 500 },
  ]);
  assertEquals(input.subTotal, 4000);
  // Lehenga is the heaviest unit, so the parcel goes in the box.
  assertEquals([input.lengthCm, input.breadthCm, input.heightCm], [45, 35, 12]);
  // Lehenga 2 kg heaviest + 0.5 per extra unit (2 Kurtis)
  assertEquals(input.weightKg, 3);
  assertEquals(input.billing.phone, "9876543210");
  assertEquals(input.billing.address2, "Near Clock Tower");
  assertEquals(input.billing.state, "Uttar Pradesh");
});

Deno.test("createLines: stock-race units (never took stock) are left out", () => {
  const items = fakeItems();
  items[1] = { ...items[1], stock_taken: 1, refunded_qty: 1 };
  const lines = createLines(items);
  assertEquals(lines.map((l) => [l.item.id, l.units, l.value]), [[ITEM_A, 1, 3000], [ITEM_B, 1, 500]]);
});

Deno.test("shippableDiffers: same units → false; fewer units or a dropped line → true", () => {
  const items = fakeItems();
  assertEquals(shippableDiffers(items, FULL_PLAN), false);
  assertEquals(
    shippableDiffers(items, { ...FULL_PLAN, shippable_items: [{ item_id: ITEM_A, units: 1, paid_value: 3000 }] }),
    true,
  );
  assertEquals(
    shippableDiffers(items, {
      ...FULL_PLAN,
      shippable_items: [{ item_id: ITEM_A, units: 1, paid_value: 3000 }, {
        item_id: ITEM_B,
        units: 1,
        paid_value: 500,
      }],
    }),
    true,
  );
});

Deno.test("ensureSrOrder: skips when sr_order_id is already stored", async () => {
  const db = new FakeDb();
  const sr = new FakeShiprocket();
  assertEquals(await ensureSrOrder({ db, shiprocket: sr, shopEmail: SHOP }, ORDER_ID), "exists");
  assertEquals(sr.calls.length, 0);
  assertEquals(db.calls.length, 0);
});

Deno.test("ensureSrOrder: creates, uses the shop email fallback (R17), stores ids as text", async () => {
  const db = new FakeDb({ sr_order_id: null, sr_shipment_id: null, contact_email: null });
  const sr = new FakeShiprocket();
  assertEquals(await ensureSrOrder({ db, shiprocket: sr, shopEmail: SHOP }, ORDER_ID), "created");
  const [input, fallback] = sr.calls[0].args as [SrOrderInput, string];
  assertEquals(fallback, SHOP);
  assertEquals(input.billing.email, null);
  assertEquals(db.calls, [{
    fn: "online_order_checkpoint",
    args: { p_order_id: ORDER_ID, p_step: "sr_create", p_data: { sr_order_id: "111", sr_shipment_id: "222" } },
  }]);
  assertEquals(db.order.sr_order_id, "111");
});

Deno.test("ensureSrOrder: Shiprocket failure records sr_create_failed and rethrows", async () => {
  const db = new FakeDb({ sr_order_id: null, sr_shipment_id: null });
  const sr = new FakeShiprocket();
  sr.failOnce.add("createOrder");
  await assertRejects(() => ensureSrOrder({ db, shiprocket: sr, shopEmail: SHOP }, ORDER_ID), CourierError);
  assertEquals(db.fns(), ["checkpoint:sr_create_failed"]);
  assertEquals(db.order.sr_sync_status, "failed");
  assert(String(db.order.sr_last_error).includes("injected failure"));
});

Deno.test("ensureSrOrder: cancelled before the job ran → skipped, no Shiprocket call", async () => {
  const db = new FakeDb({ sr_order_id: null, sr_shipment_id: null, status: "cancelled" });
  const sr = new FakeShiprocket();
  assertEquals(await ensureSrOrder({ db, shiprocket: sr, shopEmail: SHOP }, ORDER_ID), "skipped");
  assertEquals(sr.calls.length, 0);
});

// ---------- the job handler, through a minimal supabase-js stand-in ----------

/** Just the supabase-js surface supabaseOrdersDb uses, backed by a FakeDb. */
function fakeClient(db: FakeDb): SupabaseClient {
  const query = (table: string) => {
    const filters: Record<string, unknown> = {};
    const builder = {
      select: () => builder,
      eq: (col: string, val: unknown) => {
        filters[col] = val;
        return builder;
      },
      order: async () => ({
        data: table === "order_items" ? await db.getItems(filters.order_id as string) : [],
        error: null,
      }),
      maybeSingle: async () => ({
        data: table === "orders" ? await db.getOrder(filters.id as string) : null,
        error: null,
      }),
    };
    return builder;
  };
  const client = {
    from: query,
    rpc: async (fn: string, args: Record<string, unknown>) => {
      try {
        return { data: await db.rpc(fn, args), error: null };
      } catch (err) {
        return { data: null, error: { code: "P0001", message: (err as Error).message } };
      }
    },
  };
  return client as unknown as SupabaseClient;
}

function jobCtx(db: FakeDb, sr: FakeShiprocket | null): JobContext {
  return {
    db: fakeClient(db),
    cashfree: null,
    shiprocket: sr,
    mailer: { send: () => Promise.resolve() },
    env: { siteUrl: "https://www.bindalscreations.com", shopEmail: SHOP },
  };
}

const JOB = { id: "j1", order_id: ORDER_ID, kind: "shiprocket_create", attempts: 1 };

Deno.test("shiprocket_create job: skips when sr id exists", async () => {
  const db = new FakeDb();
  const sr = new FakeShiprocket();
  await handle(jobCtx(db, sr), JOB);
  assertEquals(sr.count("createOrder"), 0);
});

Deno.test("shiprocket_create job: creates and checkpoints", async () => {
  const db = new FakeDb({ sr_order_id: null, sr_shipment_id: null });
  const sr = new FakeShiprocket();
  await handle(jobCtx(db, sr), JOB);
  assertEquals(sr.count("createOrder"), 1);
  assertEquals(db.order.sr_order_id, "111");
});

Deno.test("shiprocket_create job: failure is recorded and thrown so the job retries", async () => {
  const db = new FakeDb({ sr_order_id: null, sr_shipment_id: null });
  const sr = new FakeShiprocket();
  sr.failOnce.add("createOrder");
  await assertRejects(() => handle(jobCtx(db, sr), JOB));
  assertEquals(db.order.sr_sync_status, "failed");
  // next attempt succeeds
  await handle(jobCtx(db, sr), JOB);
  assertEquals(db.order.sr_order_id, "111");
});

Deno.test("shiprocket_create job: no Shiprocket config → recorded failure, thrown", async () => {
  const db = new FakeDb({ sr_order_id: null, sr_shipment_id: null });
  await assertRejects(() => handle(jobCtx(db, null), JOB), Error, "not configured");
  assertEquals(db.fns(), ["checkpoint:sr_create_failed"]);
});

// ---------- runProcess: lease renewal and fencing ----------

Deno.test("runProcess renews claim before AWB call", async () => {
  const db = new FakeDb();
  const sr = new FakeShiprocket();
  let release!: () => void;
  sr.gates.set("assignAwb", new Promise<void>((r) => (release = r)));
  const run = runProcess({ db, shiprocket: sr, shopEmail: SHOP }, ORDER_ID, "admin-1", "op-1");
  while (sr.count("assignAwb") === 0) await new Promise((r) => setTimeout(r, 0));
  const last = db.calls.at(-1)!;
  assertEquals(last.fn, "online_order_claim");
  assertEquals(last.args, { p_order_id: ORDER_ID, p_action: "process", p_actor: "admin-1", p_op_key: "op-1" });
  release();
  const out = await run;
  assertEquals(out.kind, "packed");
  // every fenced write carries the op key
  for (const c of db.calls.filter((c) => c.fn === "online_order_checkpoint" || c.fn === "online_order_mark_packed")) {
    assertEquals(c.args.p_op_key, "op-1", c.fn);
  }
  // one renewal before each Shiprocket call (awb, pickup, manifest, label) after the first claim
  assertEquals(db.calls.filter((c) => c.fn === "online_order_claim").length, 5);
});

Deno.test("runProcess stops when renewal not claimed", async () => {
  class TakenOverDb extends FakeDb {
    override async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
      const out = await super.rpc<T>(fn, args);
      // Send back takes over (new key) while this worker is between steps.
      if (fn === "online_order_prepare_process") Object.assign(this.order, { op_key: "sb-1", op_action: "send_back" });
      return out;
    }
  }
  const db = new TakenOverDb();
  const sr = new FakeShiprocket();
  const out = await runProcess({ db, shiprocket: sr, shopEmail: SHOP }, ORDER_ID, "admin-1", "op-1");
  assertEquals(out, { kind: "busy" });
  assertEquals(sr.calls.length, 0);
  assert(!db.fns().includes("checkpoint:error"), "no error checkpoint over the new op");
  assertEquals(db.order.op_key, "sb-1");
  assertEquals(db.order.process_error, null);
});

Deno.test("runProcess: stale operation from a checkpoint → busy, no error checkpoint", async () => {
  class StaleDb extends FakeDb {
    override async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
      const out = await super.rpc<T>(fn, args);
      // Takeover lands during the AWB call, after the renewal.
      if (fn === "online_order_claim" && this.calls.filter((c) => c.fn === fn).length === 2) {
        Object.assign(this.order, { op_key: "sb-1", op_action: "send_back" });
      }
      return out;
    }
  }
  const db = new StaleDb();
  const sr = new FakeShiprocket();
  const out = await runProcess({ db, shiprocket: sr, shopEmail: SHOP }, ORDER_ID, "admin-1", "op-1");
  assertEquals(out, { kind: "busy" });
  assertEquals(sr.methods(), ["assignAwb"]);
  assertEquals(db.order.awb, null);
  assert(!db.fns().includes("checkpoint:error"), "no error checkpoint over the new op");
});

Deno.test("runProcess: takeover during a courier call that then fails → no error written under the new op", async () => {
  const lease = new Date(Date.now() + 5 * 60_000).toISOString();
  class TakeoverDb extends FakeDb {
    override async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
      const out = await super.rpc<T>(fn, args);
      // Send back takes over while assignAwb is in flight (after the renewal).
      if (fn === "online_order_claim" && this.calls.filter((c) => c.fn === fn).length === 2) {
        Object.assign(this.order, { op_key: "sb-1", op_action: "send_back", op_lease_until: lease });
      }
      return out;
    }
  }
  const db = new TakeoverDb();
  const sr = new FakeShiprocket();
  sr.failOnce.add("assignAwb");
  sr.failStatus = 0;
  const out = await runProcess({ db, shiprocket: sr, shopEmail: SHOP }, ORDER_ID, "admin-1", "op-1");
  assertEquals(out, { kind: "busy" });
  assertEquals(db.order.process_error, null);
  assertEquals(db.order.op_lease_until, lease);
  for (const c of db.calls.filter((c) => c.fn === "online_order_checkpoint")) assertEquals(c.args.p_op_key, "op-1");
});

Deno.test("runProcess: quoted courier refused → AWB from Shiprocket's default courier", async () => {
  const db = new FakeDb();
  const sr = new FakeShiprocket();
  sr.failOnce.add("assignAwb");
  const out = await runProcess({ db, shiprocket: sr, shopEmail: SHOP }, ORDER_ID, "admin-1", "op-1");
  assertEquals(out.kind, "packed");
  assertEquals(sr.calls.filter((c) => c.method === "assignAwb").map((c) => c.args), [[222, 10], [222, undefined]]);
  assertEquals(db.order.awb, "AWB1");
});

Deno.test("runProcess: AWB call timed out → no second courier (an AWB may exist)", async () => {
  const db = new FakeDb();
  const sr = new FakeShiprocket();
  sr.failOnce.add("assignAwb");
  sr.failStatus = 0;
  const out = await runProcess({ db, shiprocket: sr, shopEmail: SHOP }, ORDER_ID, "admin-1", "op-1");
  assertEquals(out.kind, "courier_error");
  assertEquals(sr.count("assignAwb"), 1);
});

Deno.test("runProcess: default courier refused too (empty wallet) → courier_error", async () => {
  class RefusingShiprocket extends FakeShiprocket {
    override async assignAwb(shipmentId: number, courierId?: number) {
      this.failOnce.add("assignAwb");
      return await super.assignAwb(shipmentId, courierId);
    }
  }
  const db = new FakeDb();
  const sr = new RefusingShiprocket();
  const out = await runProcess({ db, shiprocket: sr, shopEmail: SHOP }, ORDER_ID, "admin-1", "op-1");
  assertEquals(out.kind, "courier_error");
  assertEquals(sr.count("assignAwb"), 2);
  assertEquals(db.order.awb, null);
});

Deno.test("runProcess: no quoted courier → one AWB call without a courier id", async () => {
  const db = new FakeDb({ quoted_courier_id: null });
  const sr = new FakeShiprocket();
  const out = await runProcess({ db, shiprocket: sr, shopEmail: SHOP }, ORDER_ID, "admin-1", "op-1");
  assertEquals(out.kind, "packed");
  assertEquals(sr.calls.filter((c) => c.method === "assignAwb").map((c) => c.args), [[222, undefined]]);
});

Deno.test("runProcess: inline Shiprocket create checkpoints with the op key", async () => {
  const db = new FakeDb({ sr_order_id: null, sr_shipment_id: null });
  const sr = new FakeShiprocket();
  const out = await runProcess({ db, shiprocket: sr, shopEmail: SHOP }, ORDER_ID, "admin-1", "op-1");
  assertEquals(out.kind, "packed");
  const create = db.calls.find((c) => c.fn === "online_order_checkpoint" && c.args.p_step === "sr_create")!;
  assertEquals(create.args.p_op_key, "op-1");
});

// ---------- send back / rebook ----------

const PAST = "2026-10-26T00:00:00Z";
/** A Process that stalled after the AWB step (lease expired). */
const STUCK = { status: "processing", op_key: "op-1", op_action: "process", op_lease_until: PAST, awb: "AWB1" };
const PACKED = { status: "packed", awb: "AWB1", label_url: "https://example.test/label.pdf", bill_id: 9001 };
const MANUAL_TEXT = "Courier booking AWB AWB1 must be cancelled in the Shiprocket dashboard; " +
  "a superadmin then confirms it here.";

Deno.test("runSendBack: cancels the AWB, checkpoints sr_cancelled, finalizes", async () => {
  const db = new FakeDb(STUCK);
  const sr = new FakeShiprocket();
  const out = await runSendBack({ db, shiprocket: sr, shopEmail: SHOP }, ORDER_ID, "admin-1", "sb-1", false, true);
  assertEquals(out, { kind: "done", status: "paid", refundId: null });
  assertEquals(sr.methods(), ["cancelAwbs"]);
  assertEquals(sr.calls[0].args, [["AWB1"]]);
  assertEquals(db.fns(), ["online_order_claim", "checkpoint:sr_cancelled", "online_order_send_back"]);
  const cp = db.calls[1].args;
  assertEquals(cp.p_op_key, "sb-1");
  assertEquals(cp.p_data, { awb: "AWB1", sr_order_id: "111" });
  assertEquals(db.calls[2].args, { p_order_id: ORDER_ID, p_actor: "admin-1", p_op_key: "sb-1" });
  assertEquals([db.order.status, db.order.awb, db.order.sr_attempt], ["paid", null, 2]);
});

Deno.test("runSendBack: no AWB → verified order cancel, even with the AWB-cancel flag off", async () => {
  const db = new FakeDb({ ...STUCK, awb: null });
  const sr = new FakeShiprocket();
  const out = await runSendBack({ db, shiprocket: sr, shopEmail: SHOP }, ORDER_ID, "admin-1", "sb-1", false, false);
  assertEquals(out.kind, "done");
  assertEquals(sr.methods(), ["cancel"]);
  assertEquals(sr.calls[0].args, [[111]]);
});

Deno.test("runSendBack: no Shiprocket ids → finalizes without any courier call", async () => {
  const db = new FakeDb({ ...STUCK, awb: null, sr_order_id: null, sr_shipment_id: null });
  const sr = new FakeShiprocket();
  const out = await runSendBack({ db, shiprocket: sr, shopEmail: SHOP }, ORDER_ID, "admin-1", "sb-1", false, false);
  assertEquals(out.kind, "done");
  assertEquals(sr.calls.length, 0);
  assertEquals(db.fns(), ["online_order_claim", "online_order_send_back"]);
});

Deno.test("runSendBack: retry with the same key skips the cancel after sr_cancelled", async () => {
  // First attempt cancelled + checkpointed, then died before finalizing.
  const db = new FakeDb({ ...STUCK, op_key: "sb-1", op_action: "send_back", sr_cancelled_op_key: "sb-1" });
  const sr = new FakeShiprocket();
  const out = await runSendBack({ db, shiprocket: sr, shopEmail: SHOP }, ORDER_ID, "admin-1", "sb-1", false, true);
  assertEquals(out, { kind: "done", status: "paid", refundId: null });
  assertEquals(sr.calls.length, 0);
  assertEquals(db.fns(), ["online_order_claim", "online_order_send_back"]);
});

Deno.test("runSendBack: cancel failure → cancel_failed with problem, not finalized", async () => {
  const db = new FakeDb(STUCK);
  const sr = new FakeShiprocket();
  sr.failOnce.add("cancelAwbs");
  const out = await runSendBack({ db, shiprocket: sr, shopEmail: SHOP }, ORDER_ID, "admin-1", "sb-1", false, true);
  const problem = "Cancel AWB AWB1 / Shiprocket order 111 in Shiprocket dashboard";
  assertEquals(out, { kind: "cancel_failed", problem });
  assertEquals(db.order.problem, problem);
  assertEquals([db.order.status, db.order.op_action, db.order.awb], ["processing", "send_back", "AWB1"]);
  assert(!db.fns().includes("online_order_send_back"));
  assert(!db.fns().includes("checkpoint:sr_cancelled"));
});

Deno.test("runSendBack: AWB-cancel flag off → cancel_failed asking for manual confirmation", async () => {
  const db = new FakeDb(STUCK);
  const sr = new FakeShiprocket();
  const out = await runSendBack({ db, shiprocket: sr, shopEmail: SHOP }, ORDER_ID, "admin-1", "sb-1", false, false);
  assertEquals(out, { kind: "cancel_failed", problem: MANUAL_TEXT });
  assertEquals(sr.calls.length, 0);
  assertEquals(db.order.problem, MANUAL_TEXT);
  assertEquals(db.order.op_action, "send_back");
});

Deno.test("runSendBack: manual confirmation → confirm RPC, no courier call, finalized", async () => {
  const db = new FakeDb(STUCK);
  const sr = new FakeShiprocket();
  const out = await runSendBack({ db, shiprocket: sr, shopEmail: SHOP }, ORDER_ID, "super-1", "sb-1", true, false);
  assertEquals(out.kind, "done");
  assertEquals(sr.calls.length, 0);
  assertEquals(db.fns(), ["online_order_claim", "online_order_confirm_manual_cancel", "online_order_send_back"]);
  assertEquals(db.calls[1].args, { p_order_id: ORDER_ID, p_actor: "super-1", p_op_key: "sb-1" });
});

Deno.test("runSendBack: live Process lease → busy; not processing → bad_state", async () => {
  const live = new FakeDb({ ...STUCK, op_lease_until: new Date(Date.now() + 60_000).toISOString() });
  const sr = new FakeShiprocket();
  assertEquals(await runSendBack({ db: live, shiprocket: sr, shopEmail: SHOP }, ORDER_ID, "a", "sb-1", false, true), {
    kind: "busy",
  });
  const paid = new FakeDb();
  assertEquals(await runSendBack({ db: paid, shiprocket: sr, shopEmail: SHOP }, ORDER_ID, "a", "sb-1", false, true), {
    kind: "bad_state",
    status: "paid",
  });
  assertEquals(sr.calls.length, 0);
});

Deno.test("runSendBack: lost-response repeat with the finalizing key → done; other key → bad_state", async () => {
  const db = new FakeDb(STUCK);
  const sr = new FakeShiprocket();
  const deps = { db, shiprocket: sr, shopEmail: SHOP };
  await runSendBack(deps, ORDER_ID, "admin-1", "sb-1", false, true);
  assertEquals(await runSendBack(deps, ORDER_ID, "admin-1", "sb-1", false, true), {
    kind: "done",
    status: "paid",
    refundId: null,
  });
  assertEquals(await runSendBack(deps, ORDER_ID, "admin-1", "sb-2", false, true), {
    kind: "bad_state",
    status: "paid",
  });
  assertEquals(sr.count("cancelAwbs"), 1);
});

Deno.test("runRebook: flag off and no confirmation → cancel_failed asking for manual confirmation", async () => {
  const db = new FakeDb(PACKED);
  const sr = new FakeShiprocket();
  const out = await runRebook(
    { db, shiprocket: sr, shopEmail: SHOP },
    ORDER_ID,
    "admin-1",
    "rb-1",
    false,
    "courier lost it",
    false,
    false,
  );
  assertEquals(out, { kind: "cancel_failed", problem: MANUAL_TEXT });
  assertEquals(sr.calls.length, 0);
  assertEquals([db.order.status, db.order.op_action], ["packed", "rebook"]);
  assert(!db.fns().includes("online_order_rebook"));
});

Deno.test("runRebook: flag on → AWB cancelled, checkpointed, rebooked with note and parcelLost", async () => {
  const db = new FakeDb(PACKED);
  const sr = new FakeShiprocket();
  const out = await runRebook(
    { db, shiprocket: sr, shopEmail: SHOP },
    ORDER_ID,
    "admin-1",
    "rb-1",
    true,
    "lost in transit",
    false,
    true,
  );
  assertEquals(out, { kind: "done", status: "cancelled", refundId: "refund-rebook" });
  assertEquals(sr.methods(), ["cancelAwbs"]);
  assertEquals(db.fns(), ["online_order_claim", "checkpoint:sr_cancelled", "online_order_rebook"]);
  assertEquals(db.calls[2].args, {
    p_order_id: ORDER_ID,
    p_actor: "admin-1",
    p_op_key: "rb-1",
    p_parcel_lost: true,
    p_note: "lost in transit",
  });
});

Deno.test("runRebook: superadmin manual confirmation finalizes without the API", async () => {
  const db = new FakeDb(PACKED);
  const sr = new FakeShiprocket();
  const out = await runRebook(
    { db, shiprocket: sr, shopEmail: SHOP },
    ORDER_ID,
    "super-1",
    "rb-1",
    false,
    "wrong item packed",
    true,
    false,
  );
  assertEquals(out, { kind: "done", status: "paid", refundId: null });
  assertEquals(sr.calls.length, 0);
  assertEquals(db.fns(), ["online_order_claim", "online_order_confirm_manual_cancel", "online_order_rebook"]);
});
