export function buildBillFilename({ date, supplierName, invoiceNumber, transactionId, ext, suffix }) {
  const [year, month, day] = date.split("-");
  const datePart = `${day}${month}${year.slice(2)}`;
  const supplierPart = (supplierName || "").replace(/[^a-zA-Z0-9]/g, "");
  const invoicePart = (invoiceNumber?.trim() ? invoiceNumber.trim() : String(transactionId)).replace(/[^a-zA-Z0-9]+/g, "-");
  const extPart = (ext || "").toLowerCase();
  const suffixPart = suffix ? `_${suffix}` : "";
  return `${datePart}_${supplierPart}_${invoicePart}${suffixPart}.${extPart}`;
}
