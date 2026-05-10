# SMS Bill Sharing — One-Time Setup

Sends a short SMS with a 7-day signed invoice link when staff clicks the message icon on any finalized bill.

---

## 1. MSG91 Account

1. Sign up at [msg91.com](https://msg91.com)
2. Complete KYC (business details)

---

## 2. DLT Registration (India mandatory — takes 1–3 days)

DLT (Distributed Ledger Technology) is TRAI-mandated for all commercial SMS in India.

1. Go to **Settings → DLT** inside MSG91, or register directly at your carrier's DLT portal (Airtel / Vodafone / BSNL)
2. Register your **entity** (business name, GST, address)
3. Register **Sender ID**: `BNDLCR` (6 chars, alphanumeric)
4. Submit the following **message template** for approval under the **Transactional** category:

```
Dear {#var#}, your bill no. {#var#} of Rs {#var#} is ready. View invoice: {#var#} -BNDLCR
```

Variable order matches the Edge Function:
| Position | Value |
|----------|-------|
| `{#var#}` 1 | Customer name |
| `{#var#}` 2 | Bill number |
| `{#var#}` 3 | Amount (Rs) |
| `{#var#}` 4 | Signed PDF URL (7-day expiry) |

5. Copy the approved **Template ID** — you'll need it in Step 4

---

## 3. MSG91 Flow Setup

1. In MSG91 dashboard → **SMS** → **Flow**
2. Create a new flow using the DLT-approved template above
3. Note the **Flow ID** (this is `MSG91_TEMPLATE_ID`)
4. Note your **API Key** from MSG91 → Settings → API Keys

---

## 4. Supabase Edge Function Deployment

Install Supabase CLI if not already:
```bash
npm install -g supabase
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

Set secrets (never commit these):
```bash
supabase secrets set MSG91_API_KEY=<your_msg91_api_key>
supabase secrets set MSG91_TEMPLATE_ID=<your_flow_template_id>
supabase secrets set MSG91_SENDER_ID=BNDLCR
```

Verify secrets are set:
```bash
supabase secrets list
```

---

## 5. Supabase Storage — `invoices` Bucket RLS

The `invoices` storage bucket must allow the Edge Function (service role) to generate signed URLs. Confirm:

- Bucket name: `invoices`
- Bucket visibility: **Private** (not public) — signed URLs handle access
- Service role has `storage.objects.select` permission (default for service role)

If the bucket is currently **public**, change it to private in the Supabase dashboard → Storage → `invoices` → Edit Bucket → uncheck "Public bucket". Existing `pdf_url` values stored in the `bills` table are public URLs used for internal admin viewing — these continue to work for the admin panel. Customers only ever receive the signed URL.

---

## How It Works

```
Staff clicks SMS icon on finalized bill
  → BillTable fetches customer phone from DB
  → Generates 7-day signed URL from storage path: bill-{bill_number}.pdf
  → Calls Edge Function: send-bill-sms
  → Edge Function calls MSG91 Flow API
  → Customer receives SMS from BNDLCR
```

**Corrected bills:** re-generating a PDF overwrites the same storage path (`upsert: true`). A fresh signed URL always serves the latest version — no stale links.

**No phone on record:** button shows error toast, no SMS sent.

**No PDF yet:** SMS button is disabled until bill is finalized and PDF is uploaded.

---

## Cost Estimate (MSG91)

| Item | Cost |
|------|------|
| Transactional SMS | ~₹0.18–0.22 per message |
| Sender ID registration | Free |
| DLT entity registration | Free |

---

## Troubleshooting

| Symptom | Check |
|---------|-------|
| "MSG91 not configured" toast | Secrets not set — run `supabase secrets list` |
| "SMS failed" with MSG91 error | Template ID mismatch or DLT not approved yet |
| Signed URL in SMS returns 400 | Storage bucket is still public — switch to private |
| Customer has no phone | Update customer record in admin panel |
