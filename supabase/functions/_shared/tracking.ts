/**
 * Maps Shiprocket `shipment_status_id` (the SHIPMENT scheme, not the order
 * scheme used by `current_status_id`) onto our order tracking states.
 * Source: docs/superpowers/specs/2026-10-23-api-notes-shiprocket.md §8 and
 * plan revision R15.
 *
 * 'problem' sets orders.problem without changing status. 8/45 'cancelled'
 * is a courier-side cancellation; callers decide what it means (R15: after
 * packing it is a problem, never a business cancel/refund).
 * null = no state change; the caller still logs the raw id.
 */

export type TrackingStatus =
  | "shipped"
  | "out_for_delivery"
  | "delivered"
  | "rto"
  | "cancelled"
  | "problem";

const STATUS_BY_SHIPMENT_ID = new Map<number, TrackingStatus>([
  // 42 Picked Up, 6 Shipped, 18 In Transit, 38 Reached Destination Hub, 22 Delayed
  [42, "shipped"],
  [6, "shipped"],
  [18, "shipped"],
  [38, "shipped"],
  [22, "shipped"],
  [17, "out_for_delivery"],
  [7, "delivered"],
  // 9 RTO Initiated, 14 RTO Acknowledged, 10 RTO Delivered (back at shop)
  [9, "rto"],
  [14, "rto"],
  [10, "rto"],
  // 8 Cancelled, 45 Cancelled Before Dispatched
  [8, "cancelled"],
  [45, "cancelled"],
  // R15: 12 Lost, 21 Undelivered, 24 Destroyed, 25 Damaged, 40 RTO NDR,
  // 41 RTO OFD, 46 RTO In Transit, 76 Untraceable, 78 Reached Back At Seller City
  [12, "problem"],
  [21, "problem"],
  [24, "problem"],
  [25, "problem"],
  [40, "problem"],
  [41, "problem"],
  [46, "problem"],
  [76, "problem"],
  [78, "problem"],
]);

export function mapShipmentStatus(shipmentStatusId: number): TrackingStatus | null {
  return STATUS_BY_SHIPMENT_ID.get(shipmentStatusId) ?? null;
}
