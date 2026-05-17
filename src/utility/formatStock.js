export function formatStock(value, unitType = "piece") {
  if (isNaN(value)) return unitType === "meter" ? "0 m" : "0 pcs";
  const num = Number(value);
  const formatted =
    unitType === "meter"
      ? num.toLocaleString("en-IN", { maximumFractionDigits: 3 })
      : num.toLocaleString("en-IN", { maximumFractionDigits: 0 });
  return `${formatted} ${unitType === "meter" ? "m" : "pcs"}`;
}
