// src/admin/lib/billSlipPhotos.js
// Photos of the handwritten slip a bill was entered from, kept for auditing bills against
// paper. Shared by the billing screen and the admin CLI. Functions take the Supabase client
// as a parameter; imports carry .js extensions for Node ESM.
//
// Callers shrink photos to JPEG before calling addSlipPhoto (the browser with resizePhoto,
// the CLI with macOS sips). The bucket refuses anything else, so the checks here only give a
// clearer message before anything is written.

export const SLIP_BUCKET = "bill-slips";
export const MAX_SLIP_BYTES = 2 * 1024 * 1024;
const SIGNED_URL_SECONDS = 3600;

export class SlipPhotoInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "SlipPhotoInputError";
  }
}

const COLUMNS = "id, billid, path, uploaded_at";

export async function listSlipPhotos(client, billid) {
  const { data, error } = await client
    .from("bill_slip_photos")
    .select(COLUMNS)
    .eq("billid", billid)
    .order("uploaded_at");
  if (error) throw error;
  return data ?? [];
}

/**
 * Records the photo, then uploads it to the path the database generated for that row.
 * The storage policy only accepts a file whose row exists, so the row has to come first;
 * a failed upload takes the row back out.
 */
export async function addSlipPhoto(client, billid, { body, contentType, size }) {
  if (contentType !== "image/jpeg") {
    throw new SlipPhotoInputError(`Slip photo must be a JPEG, got ${contentType || "an unknown type"}`);
  }
  if (size > MAX_SLIP_BYTES) {
    throw new SlipPhotoInputError(
      `Slip photo is ${(size / 1024 / 1024).toFixed(1)} MB after shrinking; the limit is 2 MB`,
    );
  }
  const { data: photo, error: rowErr } = await client
    .from("bill_slip_photos")
    .insert({ billid })
    .select(COLUMNS)
    .single();
  if (rowErr) throw new Error(`Could not record slip photo for bill ${billid}: ${rowErr.message}`);

  const { error: upErr } = await client.storage
    .from(SLIP_BUCKET)
    .upload(photo.path, body, { contentType, upsert: false });
  if (upErr) {
    const { error: delErr } = await client.from("bill_slip_photos").delete().eq("id", photo.id);
    throw new Error(
      `Slip photo upload for bill ${billid} failed: ${upErr.message}` +
        (delErr ? ` — AND removing its record ${photo.id} failed: ${delErr.message}` : ""),
    );
  }
  return photo;
}

/** Deletes the row first: a file left behind costs only storage, a row without a file breaks viewing. */
export async function removeSlipPhoto(client, photo) {
  const { data, error } = await client.from("bill_slip_photos").delete().eq("id", photo.id).select("id");
  if (error) throw error;
  if (!data?.length) throw new Error(`Slip photo ${photo.id} was not removed (not found or not allowed)`);
  const { error: fileErr } = await client.storage.from(SLIP_BUCKET).remove([photo.path]);
  if (fileErr) console.warn("slip photo file not removed", { id: photo.id, path: photo.path, message: fileErr.message });
}

export async function slipPhotoUrl(client, photo) {
  const { data, error } = await client.storage.from(SLIP_BUCKET).createSignedUrl(photo.path, SIGNED_URL_SECONDS);
  if (error) throw error;
  return data.signedUrl;
}

/** The photo row and its file bytes, or null when no photo has that id. */
export async function downloadSlipPhoto(client, id) {
  const { data: photo, error } = await client.from("bill_slip_photos").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!photo) return null;
  const { data: blob, error: dlErr } = await client.storage.from(SLIP_BUCKET).download(photo.path);
  if (dlErr) throw new Error(`Could not download slip photo ${id}: ${dlErr.message}`);
  return { photo, bytes: new Uint8Array(await blob.arrayBuffer()) };
}
