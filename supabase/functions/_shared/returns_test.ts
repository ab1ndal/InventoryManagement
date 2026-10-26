import { assertEquals, assertThrows } from "@std/assert";
import { HttpError } from "./http.ts";
import { isoTimestamp, mapOpenReturn, mapReceiveItems, photoExtFor } from "./returns.ts";

const ORDER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACTOR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ITEM = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OPEN = {
  reason: "damaged_wrong",
  contactedAt: "2026-10-20T10:00:00Z",
  items: [{ itemId: ITEM, units: 1 }],
  note: "torn seam",
};

const is400 = (fn: () => unknown) => assertThrows(fn, HttpError);

Deno.test("photoExtFor maps allowed types, rejects the rest", () => {
  assertEquals(photoExtFor("image/jpeg"), "jpg");
  assertEquals(photoExtFor("image/png"), "png");
  assertEquals(photoExtFor("image/webp"), "webp");
  assertEquals(photoExtFor("image/heic"), "heic");
  assertEquals(photoExtFor("image/heif"), "heic");
  for (const t of ["application/pdf", "", undefined, 5, "image/gif"]) {
    is400(() => photoExtFor(t));
  }
});

Deno.test("mapOpenReturn maps camelCase to RPC args", () => {
  assertEquals(
    mapOpenReturn({ ...OPEN, returnAwb: " AWB1 " }, ORDER, ACTOR, true),
    {
      p_order_id: ORDER,
      p_actor: ACTOR,
      p_is_superadmin: true,
      p_reason: "damaged_wrong",
      p_contacted_at: "2026-10-20T10:00:00Z",
      p_items: [{ item_id: ITEM, units: 1 }],
      p_note: "torn seam",
      p_return_awb: "AWB1",
      p_override_reason: null,
    },
  );
});

Deno.test("mapOpenReturn rejects bad reason, missing note, bad units, duplicates, empty items", () => {
  is400(() => mapOpenReturn({ ...OPEN, reason: "nope" }, ORDER, ACTOR, false));
  is400(() => mapOpenReturn({ ...OPEN, note: " " }, ORDER, ACTOR, false));
  is400(() =>
    mapOpenReturn(
      { ...OPEN, items: [{ itemId: ITEM, units: 1.5 }] },
      ORDER,
      ACTOR,
      false,
    )
  );
  is400(() =>
    mapOpenReturn(
      { ...OPEN, items: [{ itemId: ITEM, units: 0 }] },
      ORDER,
      ACTOR,
      false,
    )
  );
  is400(() =>
    mapOpenReturn(
      { ...OPEN, items: [{ itemId: "x", units: 1 }] },
      ORDER,
      ACTOR,
      false,
    )
  );
  is400(() =>
    mapOpenReturn(
      {
        ...OPEN,
        items: [{ itemId: ITEM, units: 1 }, { itemId: ITEM, units: 1 }],
      },
      ORDER,
      ACTOR,
      false,
    )
  );
  is400(() => mapOpenReturn({ ...OPEN, items: [] }, ORDER, ACTOR, false));
  is400(() => mapOpenReturn({ ...OPEN, contactedAt: "2026-10-20" }, ORDER, ACTOR, false));
});

Deno.test("mapReceiveItems maps units and checks restock <= received", () => {
  assertEquals(
    mapReceiveItems([{ itemId: ITEM, receivedUnits: 2, restockUnits: 1 }]),
    [
      { item_id: ITEM, received_units: 2, restock_units: 1 },
    ],
  );
  is400(() => mapReceiveItems([{ itemId: ITEM, receivedUnits: 1, restockUnits: 2 }]));
  is400(() => mapReceiveItems([{ itemId: ITEM, receivedUnits: -1, restockUnits: 0 }]));
  is400(() => mapReceiveItems([{ itemId: ITEM, receivedUnits: 1 }]));
});

Deno.test("isoTimestamp requires a zone", () => {
  assertEquals(
    isoTimestamp("2026-10-20T10:00:00+05:30", "t"),
    "2026-10-20T10:00:00+05:30",
  );
  is400(() => isoTimestamp("2026-10-20T10:00:00", "t"));
  is400(() => isoTimestamp("2026-13-40T10:00:00Z", "t"));
});
