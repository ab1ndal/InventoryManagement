import { assert, assertEquals, assertRejects } from "@std/assert";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildSrInput,
  CourierError,
  createLines,
  ensureSrOrder,
  PARCEL_BREADTH_CM,
  PARCEL_HEIGHT_CM,
  PARCEL_LENGTH_CM,
  shippableDiffers,
} from "./process.ts";
import { FakeDb, fakeItems, fakeOrder, FakeShiprocket, FULL_PLAN, ITEM_A, ITEM_B, ORDER_ID } from "./process_fakes.ts";
import { handle } from "./jobs/shiprocket_create.ts";
import type { JobContext } from "./jobs/types.ts";
import type { SrOrderInput } from "./shiprocket.ts";

const SHOP = "shop@example.com";

Deno.test("buildSrInput: paid values, sub_total, box dims, weight by category per unit", () => {
  const input = buildSrInput(fakeOrder(), createLines(fakeItems()));
  assertEquals(input.orderRef, "WEB-000123");
  assertEquals(input.items, [
    { name: "Lehenga / M / Red", sku: "BC25001-M-Red", units: 1, sellingPrice: 3000 },
    { name: "Kurti / L / Blue", sku: "BC25002-L-Blue", units: 2, sellingPrice: 500 },
  ]);
  assertEquals(input.subTotal, 4000);
  assertEquals([input.lengthCm, input.breadthCm, input.heightCm], [
    PARCEL_LENGTH_CM,
    PARCEL_BREADTH_CM,
    PARCEL_HEIGHT_CM,
  ]);
  assertEquals([PARCEL_LENGTH_CM, PARCEL_BREADTH_CM, PARCEL_HEIGHT_CM], [32, 28, 5]);
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
