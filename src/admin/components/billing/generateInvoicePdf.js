import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

/**
 * Captures a DOM node and returns a PDF Blob.
 * @param {HTMLElement} node - DOM node to capture (ref.current)
 * @param {'a4'|'a5'|string} [format='a4'] - jsPDF page format
 * @returns {Promise<Blob>} PDF blob
 */
export async function generateInvoicePdf(node, format = 'a4') {
  if (!node) throw new Error("generateInvoicePdf: node is null");

  const canvas = await html2canvas(node, {
    scale: 2,
    backgroundColor: "#ffffff",
    useCORS: true,
    logging: false,
  });

  const pdf = new jsPDF({ unit: "pt", format, orientation: "portrait" });
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
