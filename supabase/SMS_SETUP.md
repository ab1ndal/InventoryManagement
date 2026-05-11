# Bill Sharing via WhatsApp — One-Time Setup

Sends bill to customer via WhatsApp when staff clicks the message icon on a finalized bill. If WhatsApp fails, give customer a paper bill.

---

## 1. WhatsApp Setup via Meta Cloud API

Free tier: 1,000 conversations/month.

> **Note:** WhatsApp Business app and API cannot share the same number. Use a dedicated alternate number.

**Step 1 — Create Meta App**
1. developers.facebook.com → **My Apps → Create App → Business**
2. Add **WhatsApp** product

**Step 2 — Add Phone Number**
1. WhatsApp → **API Setup** → add alternate number → verify via OTP

**Step 3 — Create Message Template**
1. WhatsApp → **Message Templates → Create Template**
2. Category: **Utility**, Language: **English**
3. Name: e.g. `bindals_invoice` → this is `WHATSAPP_TEMPLATE_NAME`
4. Body:
```
Dear {{1}}, your bill no. {{2}} of Rs {{3}} is ready. View invoice: {{4}}
```
5. Submit for Meta approval (~1–24 hours)

**Step 4 — Get Credentials**

From Meta app → WhatsApp → API Setup:
- **Phone Number ID** → `WHATSAPP_PHONE_NUMBER_ID`
- **Permanent Access Token** → generate via System User in Business Manager → `WHATSAPP_ACCESS_TOKEN`

---

## 2. Supabase Edge Function Deployment

Install Supabase CLI:
```bash
brew install supabase/tap/supabase
```

Login and link:
```bash
supabase login
supabase link --project-ref epotsxdugwfhyeiudjox
```

Deploy:
```bash
supabase functions deploy send-bill-sms
```

Set secrets:
```bash
supabase secrets set WHATSAPP_PHONE_NUMBER_ID=<phone_number_id>
supabase secrets set WHATSAPP_ACCESS_TOKEN=<permanent_access_token>
supabase secrets set WHATSAPP_TEMPLATE_NAME=<template_name>
```

Verify:
```bash
supabase secrets list
```

---

## 3. Supabase Security Setup ✅ COMPLETED

### 3a. Row Level Security ✅
RLS enabled on all 22 tables. Only authenticated admins can read/write data. Run `schema/migration_rls_all_tables.sql` if setting up from scratch.

### 3b. Storage bucket — private ✅
Bucket `invoices` is private. Admin-only policies applied:
```sql
CREATE POLICY "admin_select_invoices" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'invoices' AND is_admin());

CREATE POLICY "admin_update_invoices" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'invoices' AND is_admin());

CREATE POLICY "admin_insert_invoices" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'invoices' AND is_admin());
```

### 3c. Migrate existing pdf_url values ✅
```sql
UPDATE bills
SET pdf_url = regexp_replace(
  pdf_url,
  '^https://[^/]+/storage/v1/object/public/invoices/',
  ''
)
WHERE pdf_url LIKE '%/storage/v1/object/public/invoices/%';
```
`pdf_url` stores filename only. Signed URLs generated on demand.

---

## How It Works

```
Staff clicks message icon on finalized bill
  → BillTable fetches customer phone from DB
  → Generates 7-day signed URL from stored pdf_url path
  → Calls Edge Function: send-bill-sms
  → WhatsApp message sent via Meta Cloud API
      → Success → toast "WhatsApp sent"
      → Failure → toast error → give customer paper bill
```

**Admin viewing:** FileText icon → fresh 1-hour signed URL on every click.

**Regenerated PDFs:** versioned filename stored in `pdf_url`. Admin view and customer link always use latest.

**No phone on record:** error toast, give paper bill.

**No PDF yet:** button disabled until bill finalized and PDF uploaded.

---

## Cost Estimate

| Item | Cost |
|------|------|
| WhatsApp (Meta Cloud API) | Free up to 1,000 conversations/month; ~$0.005–0.02 after |

---

## Troubleshooting

| Symptom | Check |
|---------|-------|
| "WhatsApp not configured" toast | Secrets not set — run `supabase secrets list` |
| "WhatsApp delivery failed" | Meta template not approved, or wrong template name |
| Signed URL returns 403 | Storage RLS policy missing — re-run Section 3b SQL |
| Admin can't view PDF | `pdf_url` still old public URL — run Section 3c migration |
| "Bucket not found" | Bucket name must be exactly `invoices` (lowercase) |
| Customer has no phone | Give paper bill |
