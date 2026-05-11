# Bill Sharing via WhatsApp / SMS — One-Time Setup

Sends bill to customer via WhatsApp first. If WhatsApp fails, falls back to SMS automatically. Staff sees "WhatsApp sent" or "SMS sent" toast.

---

## 1. MSG91 Account

1. Sign up at [msg91.com](https://msg91.com)
2. Complete KYC (business details)

---

## 2. DLT Registration — SMS (India mandatory — takes 1–3 days)

DLT (Distributed Ledger Technology) is TRAI-mandated for all commercial SMS in India.

1. Go to **Settings → DLT** inside MSG91, or register directly at your carrier's DLT portal (Airtel / Vodafone / BSNL)
2. Register your **entity** (business name, GST, address)
3. Register **Sender ID**: `BNDLCR` (6 chars, alphanumeric)
4. Submit the following **message template** for approval under the **Transactional** category:

```
Dear {#var#}, your bill no. {#var#} of Rs {#var#} is ready. View invoice: {#var#} -BNDLCR
```

Variable order:

| Position      | Value                                             |
| ------------- | ------------------------------------------------- |
| `{#var#}` 1 | Customer name                                     |
| `{#var#}` 2 | Bill number                                       |
| `{#var#}` 3 | Amount (Rs)                                       |
| `{#var#}` 4 | Signed PDF URL (shortened by MSG91, 7-day expiry) |

5. Copy the approved **Template ID** — needed in Step 4

---

## 3. MSG91 Flow Setup — SMS

1. In MSG91 dashboard → **SMS** → **Flow**
2. Create a new flow using the DLT-approved template above
3. Note the **Flow ID** (this is `MSG91_TEMPLATE_ID`)
4. Note your **API Key** from MSG91 → Settings → API Keys

---

## 4. WhatsApp Setup via MSG91 (optional but recommended)

WhatsApp is attempted first before SMS. If not configured, function sends SMS directly.

1. In MSG91 dashboard → **WhatsApp** → connect your WhatsApp Business number
2. Create and get approved a WhatsApp message template with the same content as the SMS template above — same 4 variables in the same order (customer name, bill number, amount, PDF URL)
3. Note the **template name:** bindals_invoice and the **integrated number** (your WhatsApp Business number with country code, e.g. `919810000000`)

Set secrets:

```bash
supabase secrets set MSG91_WHATSAPP_NUMBER=<integrated_number>
supabase secrets set MSG91_WHATSAPP_TEMPLATE=<template_name>
```

Without these secrets, function skips WhatsApp and goes straight to SMS.

---

## 5. Supabase Edge Function Deployment

Install Supabase CLI:

```bash
brew install supabase/tap/supabase
```

Login and link project:

```bash
supabase login
supabase link --project-ref epotsxdugwfhyeiudjox
```

Deploy the function:

```bash
supabase functions deploy send-bill-sms
```

Set required secrets:

```bash
supabase secrets set MSG91_API_KEY=<your_msg91_api_key>
supabase secrets set MSG91_TEMPLATE_ID=<your_flow_template_id>
supabase secrets set MSG91_SENDER_ID=BNDLCR
```

Verify:

```bash
supabase secrets list
```

---

## 6. Supabase Security Setup ✅ COMPLETED

These steps have already been applied to the project.

### 6a. Row Level Security on all tables ✅

RLS enabled on all 22 tables. Only authenticated admins can read/write data. Run `schema/migration_rls_all_tables.sql` if setting up from scratch.

### 6b. Storage bucket — private ✅

- Bucket `invoices` is set to **private**
- Public read policy removed
- Admin-only policies applied:

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

### 6c. Migrate existing pdf_url values ✅

Old `bills.pdf_url` stored full public URLs. Migrated to filename-only paths:

```sql
UPDATE bills
SET pdf_url = regexp_replace(
  pdf_url,
  '^https://[^/]+/storage/v1/object/public/invoices/',
  ''
)
WHERE pdf_url LIKE '%/storage/v1/object/public/invoices/%';
```

After migration, `pdf_url` stores only the filename (e.g., `bill-FY26-000011.pdf`). Signed URLs are generated on demand.

---

## How It Works

```
Staff clicks message icon on finalized bill
  → BillTable fetches customer phone from DB
  → Generates 7-day signed URL from stored pdf_url path
  → Calls Edge Function: send-bill-sms
  → Edge Function tries WhatsApp (if MSG91_WHATSAPP_* secrets set)
      → WhatsApp succeeds → done, toast shows "WhatsApp sent"
      → WhatsApp fails → falls back to SMS
  → SMS via MSG91 Flow API (short_url: "1" auto-shortens link)
  → Toast shows "SMS sent"
```

**Admin viewing:** FileText icon generates fresh 1-hour signed URL on click — always works.

**Regenerated PDFs:** regen stores versioned filename in `pdf_url` (e.g., `bill-FY26-000011-v1234567890.pdf`). Both admin view and customer link use the stored path.

**No phone on record:** error toast, nothing sent.

**No PDF yet:** button disabled until bill is finalized and PDF uploaded.

---

## Cost Estimate

| Item                         | Cost                                               |
| ---------------------------- | -------------------------------------------------- |
| Transactional SMS (MSG91)    | ~₹0.18–0.22 per message                          |
| WhatsApp (MSG91)             | Varies by conversation type — check MSG91 pricing |
| Sender ID / DLT registration | Free                                               |

---

## Troubleshooting

| Symptom                       | Check                                                                                     |
| ----------------------------- | ----------------------------------------------------------------------------------------- |
| "MSG91 not configured" toast  | Secrets not set — run `supabase secrets list`                                          |
| "SMS failed" with MSG91 error | Template ID mismatch or DLT not approved yet                                              |
| WhatsApp not sending          | `MSG91_WHATSAPP_NUMBER` / `MSG91_WHATSAPP_TEMPLATE` not set, or template not approved |
| Always falls back to SMS      | WhatsApp secrets missing or WhatsApp template name wrong                                  |
| Signed URL returns 403        | Storage RLS policy missing — re-run Section 6b SQL                                       |
| Admin can't view PDF          | `pdf_url` may still be old public URL — run Section 6c migration                       |
| "Bucket not found"            | Bucket name must be exactly `invoices` (lowercase)                                      |
| Customer has no phone         | Update customer record in admin panel                                                     |
