# Cloudflare R2 Setup — Product Image/Video Storage

## Why R2

- Zero egress fees (pay only storage, not downloads)
- 10 GB free tier
- S3-compatible API → easy to swap later
- CDN built-in via Cloudflare network

---

## 1. Create R2 Bucket

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → **R2 Object Storage**
2. Click **Create bucket**
3. Name: `bindals-creation-assets` (or similar)
4. Region: Auto (Cloudflare picks closest)
5. Click **Create bucket**

---

## 2. Set Up Public Access (for serving images)

By default R2 buckets are private. Two options:

### Option A: Custom Domain (recommended for production)
1. In bucket settings → **Public Access** → **Connect domain**
2. Enter a subdomain you control: `assets.yourdomain.com`
3. Cloudflare auto-creates DNS record
4. Images served at: `https://assets.yourdomain.com/products/BC25001/hero.jpg`

### Option B: R2.dev subdomain (quick, free, no custom domain needed)
1. In bucket settings → **Public Access** → **Allow Access**
2. You get a URL like: `https://pub-xxxxxxxxxxxx.r2.dev`
3. Images served at: `https://pub-xxxxxxxxxxxx.r2.dev/products/BC25001/hero.jpg`

> Use Option B to start, migrate to Option A when going live.

---

## 3. Create API Token for Uploads

1. Top-right → **My Profile** → **API Tokens** → **Create Token**
2. Use template: **Edit Cloudflare Workers** — or create custom with:
   - Permissions: **R2 Storage — Edit**
   - Bucket: your specific bucket (scope it down)
3. Save the token — shown only once

Also note your **Account ID** from the R2 dashboard sidebar.

---

## 4. Install AWS SDK (R2 is S3-compatible)

```bash
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

---

## 5. Environment Variables

Add to `.env`:

```env
REACT_APP_R2_ACCOUNT_ID=your_account_id
REACT_APP_R2_ACCESS_KEY_ID=your_r2_access_key_id
REACT_APP_R2_SECRET_ACCESS_KEY=your_r2_secret_access_key
REACT_APP_R2_BUCKET_NAME=bindals-creation-assets
REACT_APP_R2_PUBLIC_URL=https://pub-xxxxxxxxxxxx.r2.dev
```

> **Never commit these to git.** `.env` is already in `.gitignore`.

To get `ACCESS_KEY_ID` and `SECRET_ACCESS_KEY` (separate from API token above):
1. R2 dashboard → **Manage R2 API tokens** → **Create API token**
2. Select bucket, permissions: **Object Read & Write**
3. Copy Access Key ID + Secret Access Key

---

## 6. R2 Client Utility

Create `src/lib/r2Client.js`:

```js
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.REACT_APP_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.REACT_APP_R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.REACT_APP_R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.REACT_APP_R2_BUCKET_NAME;
const PUBLIC_URL = process.env.REACT_APP_R2_PUBLIC_URL;

/**
 * Upload a file to R2.
 * @param {File} file - Browser File object
 * @param {string} key - Storage path, e.g. "products/BC25001/hero.jpg"
 * @returns {string} Public URL of uploaded file
 */
export async function uploadFile(file, key) {
  const arrayBuffer = await file.arrayBuffer();

  await r2.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: new Uint8Array(arrayBuffer),
    ContentType: file.type,
    CacheControl: 'public, max-age=31536000', // 1 year cache
  }));

  return `${PUBLIC_URL}/${key}`;
}

/**
 * Delete a file from R2.
 * @param {string} key - Storage path to delete
 */
export async function deleteFile(key) {
  await r2.send(new DeleteObjectCommand({
    Bucket: BUCKET,
    Key: key,
  }));
}

/**
 * Build public URL from a stored key.
 * @param {string} key
 * @returns {string}
 */
export function getPublicUrl(key) {
  return `${PUBLIC_URL}/${key}`;
}
```

---

## 7. Recommended Key Structure

```
products/{productId}/hero.jpg          → BC25001 hero image
products/{productId}/detail-1.jpg      → detail image 1
products/{productId}/detail-2.jpg      → detail image 2
products/{productId}/detail-3.jpg      → detail image 3
products/{productId}/video.mp4         → product video (optional)
```

This keeps all assets for a product co-located and makes deletion easy when a product is removed.

---

## 8. Usage in a Component

```jsx
import { uploadFile, deleteFile } from '@/lib/r2Client';

// Upload
async function handleImageUpload(file, productId) {
  const key = `products/${productId}/hero.jpg`;
  const url = await uploadFile(file, key);
  // Save `url` (or `key`) to Supabase products table
  await supabase.from('products').update({ image_url: url }).eq('id', productId);
}

// Delete old image before replacing
async function replaceImage(file, productId, oldKey) {
  if (oldKey) await deleteFile(oldKey);
  return handleImageUpload(file, productId);
}
```

---

## 9. Supabase Schema Change

Store the R2 key (not full URL) in the database — lets you change public URL without a migration:

```sql
-- Add to products table
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_key TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS detail_image_keys TEXT[]; -- array of keys
ALTER TABLE products ADD COLUMN IF NOT EXISTS video_key TEXT;
```

Resolve full URL at render time with `getPublicUrl(key)`.

---

## 10. CORS Configuration (required for browser uploads)

In R2 bucket settings → **CORS Policy** → add:

```json
[
  {
    "AllowedOrigins": ["http://localhost:3000", "https://yourdomain.com"],
    "AllowedMethods": ["GET", "PUT", "POST", "DELETE", "HEAD"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3600
  }
]
```

---

## Cost Estimate at Scale

| Item | Amount | Cost |
|------|--------|------|
| Storage (images, 4000 products × 3 × 1MB) | ~12 GB | Free (under 10 GB free, ~$0.18/mo after) |
| Storage (videos, 4000 × 50 MB avg) | ~200 GB | ~$3/mo |
| Egress / bandwidth | Unlimited | **$0** |
| Class A ops (uploads) | First 1M free | $0 |
| Class B ops (reads) | First 10M free | $0 |

Videos are the main cost driver. Consider compressing to <20 MB per video.

---

## Security Note

Direct browser-to-R2 uploads expose credentials in the client bundle. For a public-facing app, switch to **presigned URLs** generated server-side (Supabase Edge Function). For an internal admin tool behind login, direct upload is acceptable.
