export function formatINR(value, decimals = 0) {
  const num = Number(value);
  const safe = isNaN(num) ? 0 : num;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
    .format(safe)
    .replace(/^₹\s*/, "₹");
}
