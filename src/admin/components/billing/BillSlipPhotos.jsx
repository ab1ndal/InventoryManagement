import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "../../../components/ui/button";
import { Label } from "../../../components/ui/label";
import { supabase } from "../../../lib/supabaseClient";
import { addSlipPhoto, listSlipPhotos, removeSlipPhoto, slipPhotoUrl } from "../../lib/billSlipPhotos";
import { resizePhoto } from "../onlineOrders/resizePhoto";

// Larger than packed photos (1600): small handwritten figures must stay readable for audits.
// The CLI shrinks to the same size (scripts/admin-cli/slipPhoto.mjs).
const SLIP_MAX_SIDE_PX = 2000;

/**
 * Optional photos of the paper slip a bill was written on, picked or dropped. On a saved bill
 * they upload straight away. On a new bill they wait, already shrunk, and upload as soon as the
 * save gives the bill an id: saving closes the form, so asking staff to save first would mean
 * reopening every bill.
 */
export default function BillSlipPhotos({ billId }) {
  const [photos, setPhotos] = useState([]);
  const [waiting, setWaiting] = useState([]);
  const [pending, setPending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    if (!billId) return setPhotos([]);
    try {
      setPhotos(await listSlipPhotos(supabase, billId));
    } catch (err) {
      toast.error("Could not load slip photos", { description: err.message });
    }
  }, [billId]);

  useEffect(() => {
    load();
  }, [load]);

  const upload = useCallback(
    async (files, id) => {
      setPending(true);
      try {
        for (const file of files) {
          await addSlipPhoto(supabase, id, { body: file, contentType: file.type, size: file.size });
        }
        toast.success(files.length === 1 ? "Slip photo added" : "Slip photos added");
      } catch (err) {
        toast.error("Slip photo upload failed", { description: err.message });
      } finally {
        setPending(false);
        await load();
      }
    },
    [load],
  );

  useEffect(() => {
    if (!billId || !waiting.length) return;
    const files = waiting;
    setWaiting([]);
    upload(files, billId);
  }, [billId, waiting, upload]);

  const addPhotos = async (picked) => {
    if (!picked.length) return;
    setPending(true);
    try {
      const files = await Promise.all(picked.map((f) => resizePhoto(f, { maxSidePx: SLIP_MAX_SIDE_PX })));
      if (billId) await upload(files, billId);
      else setWaiting((prev) => [...prev, ...files]);
    } finally {
      setPending(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const dropProps = {
    onDragOver: (e) => {
      e.preventDefault();
      setDragging(true);
    },
    onDragLeave: () => setDragging(false),
    onDrop: (e) => {
      e.preventDefault();
      setDragging(false);
      if (!pending) addPhotos(Array.from(e.dataTransfer.files || []).filter((f) => f.type.startsWith("image/")));
    },
  };

  const viewPhoto = async (photo) => {
    // Opened before the await so Safari treats it as a click-initiated popup.
    const win = window.open("", "_blank");
    try {
      const url = await slipPhotoUrl(supabase, photo);
      if (win) {
        win.opener = null;
        win.location = url;
      }
    } catch (err) {
      win?.close();
      toast.error("Could not open slip photo", { description: err.message });
    }
  };

  const removePhoto = async (photo) => {
    setPending(true);
    try {
      await removeSlipPhoto(supabase, photo);
      toast.success("Slip photo removed");
    } catch (err) {
      toast.error("Could not remove slip photo", { description: err.message });
    } finally {
      setPending(false);
      await load();
    }
  };

  return (
    <section
      className={`space-y-2 rounded-md border border-dashed p-3 ${dragging ? "border-primary bg-primary/5" : ""}`}
      {...dropProps}
    >
      <Label>
        Paper slip photo <span className="text-muted-foreground text-xs font-normal">(optional)</span>
      </Label>
      {(photos.length > 0 || waiting.length > 0) && (
        <ul className="space-y-1 text-sm">
          {photos.map((photo, index) => (
            <li key={photo.id} className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="link" className="h-auto p-0" onClick={() => viewPhoto(photo)}>
                Slip photo {index + 1}
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => removePhoto(photo)}>
                Remove
              </Button>
            </li>
          ))}
          {waiting.map((file, index) => (
            <li key={`${file.name}-${index}`} className="flex flex-wrap items-center gap-2">
              <span>{file.name}</span>
              <span className="text-xs text-muted-foreground">saves with the bill</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setWaiting((prev) => prev.filter((_, i) => i !== index))}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        aria-label="Add slip photos"
        className="hidden"
        onChange={(e) => addPhotos(Array.from(e.target.files || []))}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => fileRef.current?.click()}>
          {pending ? "Saving…" : "Add slip photo"}
        </Button>
        <span className="text-xs text-muted-foreground">or drop photos here</span>
      </div>
    </section>
  );
}
