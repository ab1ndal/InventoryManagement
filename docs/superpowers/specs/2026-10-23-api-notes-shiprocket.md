# Shiprocket API notes (verified 2026-10-23)

Extends `tasks/checkout-shipping-plan.md` Phase C. Read it first; this file only adds detail and corrections.

**Primary source:** the official Postman collection behind apidocs.shiprocket.in. I downloaded it whole (1.9 MB JSON) and read it field by field:
- Rendered docs: https://apidocs.shiprocket.in/ (sections are named below as "Docs § Folder > Request")
- Raw collection: https://documenter.gw.postman.com/api/collections/8407119/SzYW1zB2?segregateAuth=true&versionTag=latest

Anything I couldn't confirm in an official source is marked **UNVERIFIED**. The Postman examples are old (2019–2024 data), so field lists show what the docs promise, not a guaranteed live shape. Check each one with a single live call before relying on it.

Base URL: `https://apiv2.shiprocket.in`. All bodies are JSON. Every call except login sends `Authorization: Bearer <token>`.

## Corrections to the Phase C plan

1. **Webhook status ids: use `shipment_status_id`, not `current_status_id`.** Shiprocket has two different numbering schemes:
   - **Order** statuses (Docs § Orders): 6 Shipped, 7 Delivered, 19 OFD, 20 In Transit, 15/16 RTO, 5 Canceled.
   - **Shipment** statuses (Docs § Shipments, § Tracking): 6 Shipped, 7 Delivered, 17 OFD, 18 In Transit, 9/10 RTO, 8 Cancelled.

   In the webhook sample, `current_status_id: 20` and `shipment_status_id: 18` both mean "IN TRANSIT". So `current_status_id` uses the order scheme. The plan's mapping (6/17/7/9/10/8/45) is the shipment scheme, so read it from `shipment_status_id`. In tracking responses, the `sr-status` field also uses the shipment scheme.
2. **Shiprocket officially says to generate a manifest after the pickup call** (Docs § Couriers > Request for Shipment Pickup: "You will have to call the 'Generate Manifest' API after the successful response of this API"). C2 should run awb → pickup → manifest → label.
3. **`billing_email` is marked REQUIRED** in the create-order parameter table. `billing_last_name` is optional. Use a fallback email if the customer has none (a live call would show whether it's really enforced: **UNVERIFIED**).
4. **An update-order endpoint exists** (item 5 below), so the Ship flow doesn't need cancel + recreate to change items or weight.

## 1. Auth

- `POST /v1/external/auth/login` with body `{ "email", "password" }` returns a JWT. Docs § Authentication API.
- The token is valid for **10 days**:
  - "The validity of this token is 10 days" (Docs § Authentication API)
  - "Auth token is valid for 240 hours(10 days)" (https://support.shiprocket.in/support/solutions/articles/43000337456-shiprocket-api-document-helpsheet)
- Login response field names: the collection has no example. Community SDKs read `token`. **UNVERIFIED** until a live call.
- `POST /v1/external/auth/logout` invalidates the token. Docs § Authentication API > Token Logout.
- **API user rules:**
  - The account owner creates it under Settings → API → Add New API User / Configure.
  - Its email must differ from the main login email.
  - The owner chooses "Modules to Access" and "Buyer's Details Access" (Allowed / Not Allowed).
  - The password/key is shown once ("we will not show it again"). Docs intro "Getting Started".
  - Up to 4 API users per account (https://support.shiprocket.in/support/solutions/articles/43000604103-how-to-create-an-api-user-can-i-have-more-than-one-api-users-).
  - Grant only the modules we call: orders, courier, tracking, shipments/labels, settings (pickup).
  - Set Buyer's Details to **Allowed**, or order and track responses may mask the address. **UNVERIFIED**: the effect of "Not Allowed" isn't documented.

## 2. Courier serviceability and rates

`GET /v1/external/courier/serviceability/` (Docs § Couriers > Check Courier Serviceability)

Query parameters:

| param | req | notes |
|---|---|---|
| `pickup_postcode` | yes | 201001 |
| `delivery_postcode` | yes | 6-digit |
| `cod` | cond. | `0` = prepaid. Required unless `order_id` is given |
| `weight` | cond. | kg, as a string. Required unless `order_id` is given |
| `order_id` | no | **Shiprocket** order id. If given, `cod` and `weight` can be dropped |
| `length`, `breadth`, `height` | no | cm |
| `declared_value` | no | rupees (needed with `is_return=1`) |
| `mode` | no | `Surface` or `Air` |
| `is_return`, `couriers_type`, `only_local`, `qc_check` | no | not needed |

**Success (HTTP 200):** top-level `status: 200`, `currency: "INR"`. Inside `data`:
- `available_courier_companies[]`
- `recommended_courier_company_id` (int)
- `shiprocket_recommended_courier_id`
- `recommended_by: { id, title }` (e.g. `{6, "Recommendation By Shiprocket"}`)
- `is_recommendation_enabled`
- `blocked_courier_companies[] { courier_company_id, courier_name, block_reason, postcode }`
- `child_courier_id`

Useful fields on each courier:
- `courier_company_id` (int) is the value passed to assign-AWB as `courier_id`.
- `courier_name`
- `rate` (number, total ₹) and `freight_charge` (number). In the example both are 54, along with `cod_charges` 0, `coverage_charges`, `other_charges` and `rto_charges`.
- `estimated_delivery_days` (**string**, e.g. "4")
- `etd` ("Jul 01, 2024", a display string) and `etd_hours` (int)
- `edd` (often "")
- `charge_weight`, `min_weight`, `is_surface`, `mode`, `cutoff_time` ("11:00")
- `city`, `state`, `postcode` (the destination's)
- `blocked` (0/1), `odablock`, `rating`, `delivery_performance`, `zone`, `realtime_tracking`, `pod_available`, `cod` (0/1)

Parse `rate` and `estimated_delivery_days` with `Number()`. The courier object also repeats the destination `state`, which can serve as a second UP check.

**Failure signals documented:**
- HTTP 422 `{ message:"Required field missing", errors:{weight,cod,order_id}, status_code:422 }`
- HTTP **200** with body `{ status: 404, message: "Order does not exist!" }` (the "Invalid Data" example, for a bad `order_id`)

**Not documented:** the exact response for a valid but unserviceable pincode. Treat all of these as not serviceable: an empty `available_courier_companies`, a missing `data`, a body `status` other than 200, or every courier `blocked: 1`. **UNVERIFIED**: confirm with a live call to an unserviceable pincode.

The recommendation sits at `data.recommended_courier_company_id`. Look up that id in `available_courier_companies`. If it's absent, fall back to the lowest `etd_hours`.

## 3. Postcode → state

`GET /v1/external/open/postcode/details?postcode=110077` (Docs § Countries > Get Locality Details)

- **200:** `{ success:true, postcode_details:{ postcode, city, locality[], state, state_code, latitude, longitude } }`
- Unknown or missing postcode: HTTP **403** with `{ message:"Mapped City-State details not found for <pc>", status_code:403 }`
- UP check: `postcode_details.state === "Uttar Pradesh"`. The `state_code` for UP is presumably "UP" (**UNVERIFIED**: the example shows "DL"). Compare on the `state` string.
- The path contains `/open/`, but the docs don't say whether it works without a Bearer token. **UNVERIFIED**: always send the token.

## 4. Create custom (adhoc) order

`POST /v1/external/orders/create/adhoc` (Docs § Create Or Update Order > Create Custom Order)

**Required fields:**
- `order_id`: string, max 50 characters. The docs advise digits and dashes and warn that letters "contradict some other API calls".
- `order_date`: "yyyy-mm-dd", time optional ("2019-07-24 11:11").
- `pickup_location`: an existing nickname (`Shop`).
- Billing: `billing_customer_name`, `billing_address`, `billing_city` (max 30 characters), `billing_pincode`, `billing_state`, `billing_country` ("India"), `billing_email`, `billing_phone`.
- `shipping_is_billing`: true/1. If false, `shipping_customer_name`, `_address`, `_city`, `_pincode`, `_state`, `_country` and `_phone` become required.
- `order_items[]`: each with `name`, `sku`, `units`, `selling_price` (per unit, **GST-inclusive**).
- `payment_method`: `"Prepaid"`.
- `sub_total`: Shiprocket does **not** compute it; send the correct figure.
- `length`, `breadth`, `height`: cm, each > 0.5.
- `weight`: kg, > 0.

**Optional fields:** `billing_last_name`, `billing_address_2`, `billing_alternate_phone`, `billing_isd_code`, `channel_id` (default "Custom"), `comment`/`reseller_name` (the "From" name on the label), `company_name`, item-level `discount`/`tax`/`hsn`, `shipping_charges`, `giftwrap_charges`, `transaction_charges`, `total_discount`, `invoice_number`, `customer_gstin`, `ewaybill_no`, `order_type`, `is_insurance_opt` (for orders over ₹2,500), `order_tag`.

**order_id rules** (quoted from the docs):
- "cannot be equal to an already existing id. Doing so does not change or affect the existing order."
- "New orders cannot be created with order id's same as that of cancelled orders."
- "If error 422 shows up despite filling in the correct details, consider changing the order_id."

**Response 200:**
```json
{ "order_id": 16161616, "shipment_id": 15151515, "status": "NEW", "status_code": 1,
  "onboarding_completed_now": 0, "awb_code": null, "courier_company_id": null, "courier_name": null }
```
- `order_id` here is the **Shiprocket** order id. Store it as `sr_order_id`.
- Errors: 400 `"Given channel id does not exist"`, 422 `{ message, errors:{field:[…]}, status_code }`.
- A duplicate `order_id` is not documented to error. Per the docs it "does not change" the existing order. The response may return the existing ids, or it may be a 422. **UNVERIFIED**. Our create-shipment function must check stored `sr_order_id` first, not rely on Shiprocket to dedupe.

**Order ref format:** our refs must be digits-and-dashes and ≤ 50 characters. A prefix such as `BC-` is allowed but advised against. Its effect on "other API calls" (likely `/courier/track?order_id=`) is **UNVERIFIED**.

## 5. Update order before AWB / cancel + recreate

`POST /v1/external/orders/update/adhoc` (Docs § Create Or Update Order > Update Order)

- Send the same payload as create, with the same `order_id` (**our** ref).
- This works only **before AWB assignment** ("before Ready to Ship status").
- Updatable: `order_items` (quantity up or down, tax/discount, add or remove items) and `is_document`.
- The success example lists everything else under `not_updated_fields`: addresses, `pickup_location`, `payment_method`, `order_date`, etc.
  - `sub_total`, `length`, `breadth`, `height` and `weight` are absent from that list, so they appear to update. **UNVERIFIED**.
  - To change the address use `POST /v1/external/orders/address/update`. To change pickup use `PATCH /v1/external/orders/address/pickup`.
- **Response:** `{ success:true, partially_update:true, not_updated_fields:"…", order_id, shipment_id, new_order_status:"NEW", old_order_status:1, awb_code:"", courier_company_id:"", courier_name:"" }`

**Cancel + recreate** needs a **new** `order_id`, because cancelled ids can't be reused (item 4). Use a suffix such as `<ref>-2`, and keep the latest `sr_order_id` on our row. Prefer update/adhoc.

## 6. AWB → pickup → manifest → label

**Assign AWB:** `POST /v1/external/courier/assign/awb` with `{ shipment_id, courier_id?, status? }` (Docs § Couriers > Generate AWB for Shipment)
- If `courier_id` is omitted, the account's default/recommended courier is used.
- `status:"reassign"` changes the courier, at most once in 24 h.
- **200:** `{ awb_assign_status: 1, response:{ data:{ awb_code, courier_company_id, courier_name, shipment_id, order_id, applied_weight, pickup_scheduled_date, assigned_date_time:{date,timezone}, routing_code, invoice_no, shipped_by:{…} } } }`
- Treat `awb_assign_status !== 1` as failure. **UNVERIFIED**: the failure body shape isn't documented. A low wallet balance is the likely cause, see item 10.
- Errors: 422 for a missing `shipment_id`, 400 `"Cannot reassign courier for this shipment."`

**Pickup:** `POST /v1/external/courier/generate/pickup` with `{ shipment_id: [id] }` (an array, **one id only**). Optional: `pickup_date: ["YYYY-MM-DD"]`, `status: "retry"`. Docs § Couriers > Request for Shipment Pickup.
- The AWB must exist first.
- A pickup date on a Sunday or holiday moves to the next working day.
- **200:** `{ pickup_status: 1, response:{ pickup_scheduled_date, pickup_token_number, status, data:"Pickup is confirmed by … For AWB :- …", pickup_generated_date } }`
- Error 400: `"Invalid shipment id"`

**Manifest:** `POST /v1/external/manifests/generate` with `{ shipment_id: [ids] }` (Docs § Labels | Manifests | Invoice > Generate Manifest)
- Needs the AWB and a pickup request first.
- **200:** `{ status:1, manifest_url }`. A bad id also returns 200, with `manifest_url: ""`.
- 400 means already manifested: `{ message, already_manifested_shipment_ids:[…] }`. Treat this as success on retry; reprint with `POST /v1/external/manifests/print`.

**Label:** `POST /v1/external/courier/generate/label` with `{ shipment_id: [ids] }` (an array is mandatory, otherwise 422) (Docs § … > Generate Label)
- The AWB must exist.
- **200:** `{ label_created:1, label_url:"https://kr-shipmultichannel.s3…/shipping-label-….pdf", response, not_created:[] }`
- An invalid id also returns 200, with `{ label_created:0, response:"No valid shipment ids to print label" }`. **Check `label_created`, not the HTTP status.**
- `label_url` is a public S3 URL. Whether it expires is **UNVERIFIED**. Store it but allow regeneration.
- A combined label + invoice exists (`/courier/generate/label-invoice`). We don't need it: we print our own Bill of Supply.

## 7. Cancel

- **Order:** `POST /v1/external/orders/cancel` with `{ ids: [sr_order_id, …] }` (**Shiprocket** ids)
  - Success is **204** with no body.
  - A bad id gives 500 `"Trying to get property of non-object"`; a missing `ids` gives 422.
  - Docs § Create Or Update Order > Cancel an Order.
- **Shipment, by AWB:** `POST /v1/external/orders/cancel/shipment/awbs` with `{ awbs: ["…"] }`
  - Only before "Out for Pickup"; up to 2,000 AWBs.
  - Returns 204 with `"Bulk Shipment cancellation is in progress"`. It's asynchronous, so confirm via tracking or webhook.
  - Docs § Shipments > Cancel a Shipment.
  - **UNVERIFIED:** our `cancelAwbs` client sends `{ awbs: [...] }` and treats any 2xx as success without reading the body; the real response has not been seen on a live shipment. Rebook keeps the API cancel off (`REBOOK_API_CANCEL` unset) until it is verified on a real shipment.
- Freight is credited back to the wallet on cancellation (https://support.shiprocket.in/support/solutions/articles/43000614621-explaining-shiprocket-passbook-charges).

## 8. Tracking

`GET /v1/external/courier/track/awb/{awb}` (Docs § Tracking > Get Tracking through AWB). Variants:
- by shipment: `/courier/track/shipment/{shipment_id}`
- by order: `/courier/track?order_id=&channel_id=`
- batch: `POST /courier/track/awbs`

**200 response:** `tracking_data`:
- `track_status` (1 = has data)
- `shipment_status` (int, **shipment scheme**)
- `shipment_track[] { awb_code, courier_name, current_status, pickup_date, delivered_date, edd, origin, destination, weight, pod, pod_status }`
- `shipment_track_activities[] { date, status (courier code), activity, location, "sr-status" (string id), "sr-status-label" }`
- `track_url` (`https://shiprocket.co//tracking/<awb>`, safe to show customers)
- `etd`

**No scans yet:** 200 with `{ tracking_data:{ track_status:0, error:"Aahh! There is no activities found…" } }`. Not an error; keep the current state.

**Shipment status ids** (Docs § Shipments / § Tracking):
- 1 AWB Assigned, 2 Label Generated, 3 Pickup Scheduled, 4 Pickup Queued, 5 Manifest Generated
- **6 Shipped, 7 Delivered, 8 Cancelled, 9 RTO Initiated, 10 RTO Delivered**
- 11 Pending, 12 Lost, 13 Pickup Error, 14 RTO Acknowledged, 15 Pickup Rescheduled, 16 Cancellation Requested
- **17 Out For Delivery, 18 In Transit**, 19 Out For Pickup, 20 Pickup Exception, 21 Undelivered, 22 Delayed, 23 Partial Delivered, 24 Destroyed, 25 Damaged, 26 Fulfilled, 27 Pickup Booked
- 38 Reached Destination Hub, 39 Misrouted, 40 RTO NDR, 41 RTO OFD, **42 Picked Up**, 43 Self Fulfilled, 44 Disposed Off, **45 Cancelled Before Dispatched**, 46 RTO In Transit, 47 QC Failed
- 48–59 cover international and fulfilment-centre states, plus 75 RTO_LOCK, 76 UNTRACEABLE, 77 ISSUE_RELATED_TO_THE_RECIPIENT, 78 REACHED_BACK_AT_SELLER_CITY

**Suggested mapping onto our states:**

| Shiprocket shipment id | Our status |
|---|---|
| 42, 6, 18, 38, 22, 17 | `shipped` (17 can also show "out for delivery") |
| 7 | `delivered` |
| 8, 45 | `cancelled` (ours if before handover) |
| 9, 46, 41, 40, 14, 10 | RTO, to flag for staff (10 = parcel back at shop) |
| 12, 24, 25, 76 | lost/damaged, to flag for staff |
| 21 | undelivered/NDR, to flag for staff |
| anything else | no state change; log it |

## 9. Webhook

Source: Docs intro § Webhooks.

**Setup:** Settings → API → Webhooks → add the URL, enable the toggle, and add a security token. The token is "not mandatory"; we set one.

**Spec:**
- Method POST, `Content-Type: application/json`.
- The token is sent as **`x-api-key`**.
- "Please do not use keywords like shiprocket, kartrocket, sr, or kr in your webhook URL".
  - Watch for hidden substrings, especially in the project ref of `https://<ref>.supabase.co`. Our path `/functions/v1/courier-status` contains no "sr" or "kr".
  - Check the full URL, including the project ref, for "sr" and "kr". **UNVERIFIED** whether matching is substring- or word-based; assume substring.
- "The URL should be set to send only code 200 in response."

**Payload fields** (from the sample):
- `awb`, `courier_name`
- `current_status` + `current_status_id` (order scheme)
- `shipment_status` + `shipment_status_id` (**shipment scheme, use this**)
- `current_timestamp` ("23 05 2023 11:43:52", DD MM YYYY)
- `order_id` (our ref, e.g. "1373900_150876814"; may carry a channel suffix, **UNVERIFIED**), `sr_order_id`
- `awb_assigned_date`, `pickup_scheduled_date`, `etd`
- `scans[] { date, status, activity, location, "sr-status", "sr-status-label" }`
- `is_return`, `channel_id`, `pod_status`, `pod`

**Retries, timeout, ordering, duplicates:** not documented anywhere official. **UNVERIFIED**. Design for duplicates and out-of-order delivery:
- Re-fetch tracking.
- Apply only forward transitions.
- Always return 200 quickly.

Compare `x-api-key` in constant time. The plan already re-fetches `/courier/track/awb/{awb}` instead of trusting the body, which keeps the shared secret low-risk.

## 10. Rate limits and costs

**Rate limit:**
- The docs list HTTP **429** "You have exceeded the API call rate limit" (Docs intro, response codes).
- Every example response carries `X-RateLimit-Limit: 180` and `X-RateLimit-Remaining`. The window (likely per minute) isn't stated. **UNVERIFIED**.
- No official per-endpoint quotas were found. On a 429, back off and fall back (C1 already returns `serviceable: null`).
- Cache serviceability results per (pincode, weight class) for a few hours to cut calls.

**Cost:**
- API calls themselves: no per-call fee is documented. **UNVERIFIED**. Serviceability, tracking and postcode calls appear free.
- **Freight is charged to the prepaid Shiprocket wallet during order processing** (practically at AWB assignment). It's reversed on cancel or reassignment, and weight-dispute excess is debited later (https://support.shiprocket.in/support/solutions/articles/43000614621-explaining-shiprocket-passbook-charges).
- Exact timing is **UNVERIFIED**. Show the wallet balance in admin via `GET /v1/external/account/details/wallet-balance` (Docs § Account) and block "Ship" if it's below the quoted `rate`.

## Live checks to run once the API user exists (all UNVERIFIED above)

1. Login response field names.
2. Serviceability for an unserviceable pincode (body shape).
3. `state` / `state_code` for a UP pincode (201001).
4. Duplicate `order_id` create response.
5. Whether update/adhoc changes weight and dimensions.
6. Assign-AWB failure body when the wallet is empty.
7. Webhook retry behaviour (watch function logs after returning 500 once on a test).
8. `X-RateLimit` window.
