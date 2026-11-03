const MAX_SIDE_PX = 1600;
const JPEG_QUALITY = 0.82;

// Customers load packed photos on a phone, so a full-size camera file is too heavy. Re-encoding also
// drops EXIF, including the GPS position phones embed. A photo the browser cannot decode goes up
// as it is, because the photo must never hold up packing; the server still checks its type and size.
export async function resizePhoto(file) {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE_PX / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    // JPEG has no transparency: without this a transparent PNG turns black.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    if (!blob) throw new Error("the browser could not encode the photo");
    return new File([blob], file.name, { type: "image/jpeg" });
  } catch (err) {
    console.warn("packed photo not resized", { name: file.name, size: file.size, message: err.message });
    return file;
  }
}
