# Media Hosting Setup — Cloudinary (Images) + YouTube (Videos)

## Architecture

| Asset | Service | Why |
|-------|---------|-----|
| Product images (hero + detail) | Cloudinary free tier | 25 GB storage, auto WebP/AVIF, URL-based resizing |
| Product videos (featured, seasonal) | YouTube unlisted | Free, unlimited, no bandwidth cost |

---

## Part 1: Cloudinary Setup

### 1.1 Create Account

1. Go to [cloudinary.com](https://cloudinary.com) → **Sign Up Free**
2. Note your **Cloud Name** from the dashboard (e.g., `my-cloud-name`)

### 1.2 Get API Credentials

Dashboard → **Settings** → **Access Keys**:
- **Cloud Name**
- **API Key**
- **API Secret**

### 1.3 Environment Variables

Add to `.env`:

```env
REACT_APP_CLOUDINARY_CLOUD_NAME=your_cloud_name
REACT_APP_CLOUDINARY_API_KEY=your_api_key
REACT_APP_CLOUDINARY_UPLOAD_PRESET=bindals_products
```

> **API Secret is server-side only** — never expose in frontend. Use Upload Presets instead (below).

### 1.4 Create an Upload Preset (for browser uploads)

1. Dashboard → **Settings** → **Upload** → **Upload Presets** → **Add upload preset**
2. Set:
   - Preset name: `bindals_products`
   - Signing mode: **Unsigned** (allows direct browser upload without exposing API secret)
   - Folder: `products` (auto-organizes uploads)
   - Optional: enable **Auto-tagging**, set **Quality** to `auto`
3. Save

### 1.5 Install Cloudinary SDK

```bash
npm install cloudinary-react @cloudinary/url-gen
```

### 1.6 Cloudinary Utility

Create `src/lib/cloudinaryClient.js`:

```js
import { Cloudinary } from '@cloudinary/url-gen';
import { auto } from '@cloudinary/url-gen/actions/resize';
import { autoGravity } from '@cloudinary/url-gen/qualifiers/gravity';
import { format, quality } from '@cloudinary/url-gen/actions/delivery';
import { auto as autoFormat } from '@cloudinary/url-gen/qualifiers/format';
import { auto as autoQuality } from '@cloudinary/url-gen/qualifiers/quality';

const cld = new Cloudinary({
  cloud: { cloudName: process.env.REACT_APP_CLOUDINARY_CLOUD_NAME },
});

/**
 * Upload an image file directly from the browser using an unsigned upload preset.
 * @param {File} file - Browser File object
 * @param {string} publicId - e.g. "products/BC25001/hero"
 * @returns {Promise<{publicId: string, url: string}>}
 */
export async function uploadImage(file, publicId) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', process.env.REACT_APP_CLOUDINARY_UPLOAD_PRESET);
  formData.append('public_id', publicId);

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${process.env.REACT_APP_CLOUDINARY_CLOUD_NAME}/image/upload`,
    { method: 'POST', body: formData }
  );

  if (!res.ok) throw new Error(`Upload failed: ${res.statusText}`);
  const data = await res.json();
  return { publicId: data.public_id, url: data.secure_url };
}

/**
 * Get an optimized image URL with auto format (WebP/AVIF) and quality.
 * @param {string} publicId - Cloudinary public ID
 * @param {number} width - Target display width in px
 * @returns {string} Optimized URL
 */
export function getImageUrl(publicId, width = 800) {
  return cld
    .image(publicId)
    .resize(auto().width(width).gravity(autoGravity()))
    .delivery(format(autoFormat()))
    .delivery(quality(autoQuality()))
    .toURL();
}

/**
 * Delete an image via Cloudinary Admin API.
 * NOTE: Requires API Secret — do this from a backend/Edge Function, not browser.
 * Store public_id in Supabase and call deletion from server-side only.
 */
export function getPublicIdFromUrl(cloudinaryUrl) {
  // Extract public_id from a Cloudinary URL for storage in Supabase
  const match = cloudinaryUrl.match(/\/upload\/(?:v\d+\/)?(.+?)(?:\.\w+)?$/);
  return match ? match[1] : null;
}
```

### 1.7 Recommended Public ID Structure

```
products/BC25001/hero          → hero image
products/BC25001/detail-1      → detail image 1
products/BC25001/detail-2      → detail image 2
products/BC25001/detail-3      → detail image 3
```

No file extension needed — Cloudinary serves the right format automatically.

### 1.8 Usage in a Component

```jsx
import { uploadImage, getImageUrl } from '@/lib/cloudinaryClient';
import { supabase } from '@/lib/supabaseClient';

// Upload hero image
async function handleHeroUpload(file, productId) {
  const publicId = `products/${productId}/hero`;
  const { publicId: storedId } = await uploadImage(file, publicId);

  // Store public_id in Supabase (not the full URL — resolves at render time)
  await supabase
    .from('products')
    .update({ image_public_id: storedId })
    .eq('id', productId);
}

// Render
function ProductImage({ publicId }) {
  if (!publicId) return null;
  return (
    <img
      src={getImageUrl(publicId, 800)}
      srcSet={`${getImageUrl(publicId, 400)} 400w, ${getImageUrl(publicId, 800)} 800w`}
      alt="Product"
      loading="lazy"
    />
  );
}
```

### 1.9 Supabase Schema Changes

Store public IDs, not full URLs — lets you change Cloudinary config without re-migrating:

```sql
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_public_id TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS detail_image_public_ids TEXT[];
```

---

## Part 2: YouTube Setup (Product Videos)

### 2.1 Upload Strategy

- Upload product videos as **Unlisted** (not public, not searchable via YouTube)
- Users with the link (or embedded player) can view — nobody else can discover it
- Seasonal rotation = toggle which products display their video, no re-uploading

### 2.2 Upload Videos

1. Go to [studio.youtube.com](https://studio.youtube.com)
2. Upload video → set visibility to **Unlisted**
3. Copy the **Video ID** from the URL: `youtube.com/watch?v=VIDEO_ID_HERE`

### 2.3 Store in Supabase

```sql
ALTER TABLE products ADD COLUMN IF NOT EXISTS youtube_video_id TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_featured BOOLEAN DEFAULT FALSE;
```

`is_featured` controls whether the video section shows on the product page.

### 2.4 Embed in React

No SDK needed — standard iframe:

```jsx
function ProductVideo({ videoId }) {
  if (!videoId) return null;
  return (
    <div className="aspect-video w-full rounded-lg overflow-hidden">
      <iframe
        src={`https://www.youtube.com/embed/${videoId}?rel=0&modestbranding=1`}
        title="Product video"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        className="w-full h-full"
      />
    </div>
  );
}

// Usage
function ProductPage({ product }) {
  return (
    <div>
      <ProductImage publicId={product.image_public_id} />
      {product.is_featured && <ProductVideo videoId={product.youtube_video_id} />}
    </div>
  );
}
```

### 2.5 Seasonal Rotation

No video re-uploading needed. Just toggle `is_featured` in Supabase:

```js
// Feature a product for the season
await supabase.from('products').update({ is_featured: true }).eq('id', productId);

// Unfeature at season end
await supabase.from('products').update({ is_featured: false }).eq('id', productId);
```

Or batch update for a seasonal collection:

```sql
-- Unfeature all, then re-feature the new seasonal set
UPDATE products SET is_featured = FALSE;
UPDATE products SET is_featured = TRUE WHERE id IN ('BC25001', 'BC25012', 'BC25034');
```

---

## Storage Estimates

| Asset | Count | Size (optimized) | Total |
|-------|-------|-----------------|-------|
| Hero images (WebP auto) | 4,000 | ~400 KB avg | ~1.6 GB |
| Detail images ×3 (WebP auto) | 12,000 | ~250 KB avg | ~3 GB |
| **Total Cloudinary** | | | **~4.6 GB** |
| Videos | Seasonal subset | YouTube stores | **$0** |

Cloudinary auto-optimization cuts storage to ~4-5 GB — well within 25 GB free tier.

---

## Free Tier Summary

| Service | Free Allowance | Usage | Headroom |
|---------|---------------|-------|----------|
| Cloudinary storage | 25 GB | ~4.6 GB | 20+ GB |
| Cloudinary bandwidth | 25 GB/month | Depends on traffic | Check monthly |
| YouTube | Unlimited | Seasonal videos | No limit |

If Cloudinary bandwidth becomes a bottleneck (high traffic), consider caching images via Cloudflare proxy — but unlikely to hit 25 GB/month for an inventory app.
