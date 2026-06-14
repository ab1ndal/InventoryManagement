export function buildBillFilename({ date, supplierName, invoiceNumber, transactionId, ext }) {
  const [year, month, day] = date.split("-");
  const datePart = `${day}${month}${year.slice(2)}`;
  const supplierPart = (supplierName || "").replace(/[^a-zA-Z0-9]/g, "");
  const invoicePart = invoiceNumber?.trim() ? invoiceNumber.trim() : String(transactionId);
  const extPart = (ext || "").toLowerCase();
  return `${datePart}_${supplierPart}_${invoicePart}.${extPart}`;
}
