import {
  listSlipPhotos,
  addSlipPhoto,
  removeSlipPhoto,
  slipPhotoUrl,
  downloadSlipPhoto,
  SlipPhotoInputError,
  MAX_SLIP_BYTES,
} from "../billSlipPhotos";
import { fakeSupabase } from "../testing/fakeSupabase";

const row = { id: "a1", billid: 7, path: "7/a1.jpg", uploaded_at: "2026-11-08T10:00:00Z" };
const jpeg = { body: "bytes", contentType: "image/jpeg", size: 500_000 };

describe("listSlipPhotos", () => {
  it("lists a bill's photos", async () => {
    const client = fakeSupabase({ "bill_slip_photos.select": { data: [row], error: null } });
    await expect(listSlipPhotos(client, 7)).resolves.toEqual([row]);
    expect(client.calls[0].filters).toEqual([["eq", "billid", 7]]);
  });
});

describe("addSlipPhoto", () => {
  it("records the row, then uploads to the path the database generated", async () => {
    const client = fakeSupabase({ "bill_slip_photos.insert": { data: row, error: null } });
    await expect(addSlipPhoto(client, 7, jpeg)).resolves.toEqual(row);
    expect(client.calls[0].row).toEqual({ billid: 7 });
    expect(client.calls[1]).toMatchObject({ op: "storage.upload", bucket: "bill-slips" });
    expect(client.calls[1].args).toEqual(["7/a1.jpg", "bytes", { contentType: "image/jpeg", upsert: false }]);
  });

  it("removes the row when the upload fails", async () => {
    const client = fakeSupabase({
      "bill_slip_photos.insert": { data: row, error: null },
      "storage.upload": { data: null, error: { message: "Payload too large" } },
    });
    await expect(addSlipPhoto(client, 7, jpeg)).rejects.toThrow("Payload too large");
    expect(client.calls[2]).toMatchObject({ table: "bill_slip_photos", op: "delete" });
    expect(client.calls[2].filters).toEqual([["eq", "id", "a1"]]);
  });

  it("refuses anything but a JPEG before writing", async () => {
    const client = fakeSupabase();
    await expect(addSlipPhoto(client, 7, { ...jpeg, contentType: "image/heic" })).rejects.toThrow(SlipPhotoInputError);
    expect(client.calls).toEqual([]);
  });

  it("refuses a photo over the size limit before writing", async () => {
    const client = fakeSupabase();
    await expect(addSlipPhoto(client, 7, { ...jpeg, size: MAX_SLIP_BYTES + 1 })).rejects.toThrow(/2 MB/);
    expect(client.calls).toEqual([]);
  });
});

describe("removeSlipPhoto", () => {
  it("deletes the row, then the file", async () => {
    const client = fakeSupabase({
      "bill_slip_photos.delete": { data: [row], error: null },
      "storage.remove": { data: [{ name: "7/a1.jpg" }], error: null },
    });
    await removeSlipPhoto(client, row);
    expect(client.calls[0].filters).toEqual([["eq", "id", "a1"]]);
    expect(client.calls[1].args).toEqual([["7/a1.jpg"]]);
  });

  it("fails when no row was deleted", async () => {
    const client = fakeSupabase({ "bill_slip_photos.delete": { data: [], error: null } });
    await expect(removeSlipPhoto(client, row)).rejects.toThrow(/not removed/);
    expect(client.calls).toHaveLength(1);
  });
});

describe("slipPhotoUrl", () => {
  it("signs the path for an hour", async () => {
    const client = fakeSupabase({ "storage.createSignedUrl": { data: { signedUrl: "https://x" }, error: null } });
    await expect(slipPhotoUrl(client, row)).resolves.toBe("https://x");
    expect(client.calls[0].args).toEqual(["7/a1.jpg", 3600]);
  });
});

describe("downloadSlipPhoto", () => {
  it("looks the photo up by id and downloads its file", async () => {
    const blob = { arrayBuffer: async () => new Uint8Array([1, 2]).buffer };
    const client = fakeSupabase({
      "bill_slip_photos.select": { data: row, error: null },
      "storage.download": { data: blob, error: null },
    });
    const out = await downloadSlipPhoto(client, "a1");
    expect(out.photo).toEqual(row);
    expect(Array.from(out.bytes)).toEqual([1, 2]);
    expect(client.calls[1].args).toEqual(["7/a1.jpg"]);
  });

  it("returns null for an unknown id", async () => {
    const client = fakeSupabase({ "bill_slip_photos.select": { data: null, error: null } });
    await expect(downloadSlipPhoto(client, "zz")).resolves.toBeNull();
  });
});
