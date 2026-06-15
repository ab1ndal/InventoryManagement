/**
 * Line total after a percentage discount: qty * unit_price * (1 - discount_pct/100).
 * Rounded to 2 decimals.
 */
export function computeLineAmount({ qty, unit_price, discount_pct }) {
  const q = Number(qty) || 0;
  const price = Number(unit_price) || 0;
  const disc = Number(discount_pct) || 0;
  const amount = q * price * (1 - disc / 100);
  return Math.round(amount * 100) / 100;
}

/**
 * Sum of line item `amount` values. Rounded to 2 decimals.
 */
export function computeTaxableAmount(lineItems) {
  const sum = (lineItems || []).reduce((total, li) => total + (Number(li.amount) || 0), 0);
  return Math.round(sum * 100) / 100;
}

/**
 * Sum of qty * unit_price across line items, before any discount. Rounded to 2 decimals.
 */
export function computeGrossAmount(lineItems) {
  const sum = (lineItems || []).reduce((total, li) => total + (Number(li.qty) || 0) * (Number(li.unit_price) || 0), 0);
  return Math.round(sum * 100) / 100;
}

/**
 * Total discount applied across line items: gross - taxable. Rounded to 2 decimals.
 */
export function computeDiscountAmount(lineItems) {
  const discount = computeGrossAmount(lineItems) - computeTaxableAmount(lineItems);
  return Math.round(discount * 100) / 100;
}

/**
 * Final bill total: taxable + CGST + SGST + IGST + round-off.
 * Rounded to 2 decimals. round_off_amount may be negative.
 */
export function computeBillTotal({ taxable_amount, cgst_amount, sgst_amount, igst_amount, round_off_amount }) {
  const total =
    (Number(taxable_amount) || 0) +
    (Number(cgst_amount) || 0) +
    (Number(sgst_amount) || 0) +
    (Number(igst_amount) || 0) +
    (Number(round_off_amount) || 0);
  return Math.round(total * 100) / 100;
}
