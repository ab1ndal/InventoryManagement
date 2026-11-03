import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "../../../components/ui/button";
import { action } from "./onlineOrdersApi";
import { formatDateTime } from "./orderHelpers";
import { resizePhoto } from "./resizePhoto";

const PHOTO_TYPES = "image/jpeg,image/png,image/webp";
const MAX_PHOTOS = 4;
const SHOWN_AT = ["packed", "shipped", "out_for_delivery", "delivered"];

export default function PackedPhotosSection({ order, onChanged }) {
  const [pending, setPending] = useState(false);
  const fileRef = useRef(null);
  const photos = order.packed_photos || [];
  if (!SHOWN_AT.includes(order.status) && !photos.length) return null;

  const addPhotos = async (files) => {
    if (!files.length) return;
    setPending(true);
    try {
      for (const picked of files) {
        const file = await resizePhoto(picked);
        const { uploadUrl, path } = await action({
          action: "packed_photo_url",
          orderId: order.id,
          contentType: file.type,
        });
        const put = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
        if (!put.ok) throw new Error(`Upload of ${file.name} failed (${put.status})`);
        await action({ action: "packed_photo_add", orderId: order.id, path });
      }
      toast.success(files.length === 1 ? "Photo added" : "Photos added");
    } catch (err) {
      toast.error("Photo upload failed", { description: err.message });
    } finally {
      setPending(false);
      if (fileRef.current) fileRef.current.value = "";
      await onChanged?.();
    }
  };

  const viewPhoto = async (photo) => {
    // Opened before the await so Safari treats it as a click-initiated popup.
    const win = window.open("", "_blank");
    try {
      const { url } = await action({ action: "packed_photo_view", photoId: photo.id });
      if (win) {
        win.opener = null;
        win.location = url;
      }
    } catch (err) {
      win?.close();
      toast.error("Could not open photo", { description: err.message });
    }
  };

  const removePhoto = async (photo) => {
    setPending(true);
    try {
      await action({ action: "packed_photo_remove", photoId: photo.id });
      toast.success("Photo removed");
    } catch (err) {
      toast.error("Could not remove photo", { description: err.message });
    } finally {
      setPending(false);
      await onChanged?.();
    }
  };

  return (
    <section className="text-sm">
      <h4 className="mb-1 font-medium">Packed photos (optional)</h4>
      <p className="mb-2 text-xs text-muted-foreground">
        The customer sees these. Take them before the label goes on, because a label shows the customer's address and phone.
      </p>
      {photos.length > 0 && (
        <ul className="mb-2 space-y-1">
          {photos.map((photo, index) => (
            <li key={photo.id} className="flex flex-wrap items-center gap-2">
              <Button variant="link" className="h-auto p-0" onClick={() => viewPhoto(photo)}>
                Photo {index + 1}
              </Button>
              <span className="text-xs text-muted-foreground">{formatDateTime(photo.uploaded_at)}</span>
              <Button variant="outline" size="sm" disabled={pending} onClick={() => removePhoto(photo)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      {SHOWN_AT.includes(order.status) && photos.length < MAX_PHOTOS && (
        <>
          <input
            ref={fileRef}
            type="file"
            accept={PHOTO_TYPES}
            multiple
            aria-label="Add packed photos"
            className="hidden"
            onChange={(e) => addPhotos(Array.from(e.target.files || []))}
          />
          <Button variant="outline" size="sm" disabled={pending} onClick={() => fileRef.current?.click()}>
            Add photos
          </Button>
        </>
      )}
    </section>
  );
}
