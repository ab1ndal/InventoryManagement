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

  const pdf = new jsPDF({ unit: "mm", format, orientation: "portrait" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  const marginX = 6;  // mm, left/right
  const marginTop = 6;    // mm
  const marginBottom = 12; // mm
  const imgWidth = pageWidth - marginX * 2;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;
  const contentHeight = pageHeight - marginTop - marginBottom;

  const scale = canvas.width / imgWidth; // px per mm
  const contentHeightPx = Math.round(contentHeight * scale);

  // Collect row bottom positions in canvas px so we can snap slice boundaries
  const nodeTop = node.getBoundingClientRect().top;
  const rowBottomsPx = Array.from(node.querySelectorAll("tr")).map(
    (tr) => (tr.getBoundingClientRect().bottom - nodeTop) * 2 // html2canvas scale=2
  );

  // Build page slices, snapping each cut to the nearest row bottom
  const slices = [];
  let srcY = 0;
  while (srcY < canvas.height) {
    const maxEnd = srcY + contentHeightPx;
    if (maxEnd >= canvas.height) {
      slices.push({ srcY, end: canvas.height });
      break;
    }
    // Last row bottom that fits entirely within this page
    const snapped = rowBottomsPx
      .filter((b) => b > srcY && b <= maxEnd)
      .at(-1);
    const end = snapped != null ? Math.floor(snapped) : maxEnd;
    slices.push({ srcY, end });
    srcY = end;
  }

  slices.forEach(({ srcY, end }, i) => {
    const sliceHeightPx = end - srcY;
    const sliceHeightMm = sliceHeightPx / scale;

    const slice = document.createElement("canvas");
    slice.width = canvas.width;
    slice.height = sliceHeightPx;
    slice.getContext("2d").drawImage(
      canvas,
      0, srcY, canvas.width, sliceHeightPx,
      0, 0,   canvas.width, sliceHeightPx
    );

    if (i > 0) pdf.addPage();
    pdf.addImage(slice.toDataURL("image/png"), "PNG", marginX, marginTop, imgWidth, sliceHeightMm);
  });

  return pdf.output("blob");
}
