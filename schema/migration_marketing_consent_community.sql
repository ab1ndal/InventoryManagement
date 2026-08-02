-- Marketing consent record + WhatsApp Community membership tracking.
--
-- Consent is stored as an append-only log rather than a single boolean because
-- the DPDP Act 2023 places the burden of proving consent on the business: a
-- complaint requires showing when consent was given, by what route, and who
-- recorded it. customers.marketing_opt_in is the derived current value used for
-- day-to-day filtering.
--
-- Community membership cannot be read programmatically (WhatsApp exposes no API
-- for Communities), so community_status is maintained by hand from the member
-- list visible to admins in the WhatsApp app.

CREATE TABLE IF NOT EXISTS public.marketing_consents (
  id          bigserial PRIMARY KEY,
  customerid  int NOT NULL REFERENCES public.customers(customerid) ON DELETE CASCADE,
  action      text NOT NULL CHECK (action IN ('opt_in', 'opt_out')),
  source      text NOT NULL CHECK (source IN (
                'counter_verbal', 'counter_form', 'storefront',
                'admin_manual', 'customer_request'
              )),
  note        text,
  recorded_by uuid REFERENCES public.profiles(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketing_consents_customer_idx
  ON public.marketing_consents (customerid, created_at DESC);

ALTER TABLE public.marketing_consents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_only ON public.marketing_consents;
CREATE POLICY admin_only ON public.marketing_consents
  FOR ALL USING (is_admin());

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS marketing_opt_in    bool NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS community_status    text NOT NULL DEFAULT 'not_added',
  ADD COLUMN IF NOT EXISTS community_status_at timestamptz;

-- States, not flags: a customer moves not_added -> invite_pending -> member,
-- and can reach left (they exited) or opted_out (they asked to stop).
ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_community_status_check;
ALTER TABLE public.customers
  ADD CONSTRAINT customers_community_status_check
  CHECK (community_status IN ('not_added', 'invite_pending', 'member', 'left', 'opted_out'));

-- Backfill: consent for existing customers was given verbally at the counter
-- when contact details were collected. Recorded honestly as counter_verbal and
-- dated to the customer record's own creation date -- this is a reconstruction
-- of an undocumented event, not a written consent record, and the note says so.
INSERT INTO public.marketing_consents (customerid, action, source, note, created_at)
SELECT
  c.customerid,
  'opt_in',
  'counter_verbal',
  'Backfilled 2026-08-01. Verbal consent taken at contact collection; no contemporaneous written record exists for this customer.',
  COALESCE(c.created_at::timestamptz, now())
FROM public.customers c
WHERE c.phone IS NOT NULL
  AND c.is_guest IS NOT TRUE
  AND NOT EXISTS (
    SELECT 1 FROM public.marketing_consents m WHERE m.customerid = c.customerid
  );

UPDATE public.customers c
SET marketing_opt_in = true
WHERE c.phone IS NOT NULL
  AND c.is_guest IS NOT TRUE
  AND c.marketing_opt_in = false;
