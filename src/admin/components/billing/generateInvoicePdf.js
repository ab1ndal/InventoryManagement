import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

/**
 * Captures a DOM node and returns a PDF Blob sized to A4 portrait.
 * @param {HTMLElement} node - InvoiceView DOM node (ref.current)
 * @returns {Promise<Blob>} PDF blob
 */
export async function generateInvoicePdf(node) {
  if (!node) throw new Error("generateInvoicePdf: node is null");

  const canvas = await html2canvas(node, {
    scale: 2,
    backgroundColor: "#ffffff",
    useCORS: true,
    logging: false,
  });

  // A4 portrait in points: 595 x 842 (jsPDF default)
  const pdf = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  // Scale the canvas to page width, preserve aspect ratio
  const imgWidth = pageWidth;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  const imgData = canvas.toDataURL("image/png");

  if (imgHeight <= pageHeight) {
    pdf.addImage(imgData, "PNG", 0, 0, imgWidth, imgHeight);
  } else {
    // Multi-page: slice the canvas into page-height chunks
    let remaining = imgHeight;
    let position = 0;
    while (remaining > 0) {
      pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
      remaining -= pageHeight;
      position -= pageHeight;
      if (remaining > 0) pdf.addPage();
    }
  }

  return pdf.output("blob");
}
