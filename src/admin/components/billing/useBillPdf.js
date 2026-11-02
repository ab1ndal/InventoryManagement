import React, { useCallback, useRef, useState } from "react";
import { flushSync } from "react-dom";
import InvoiceView from "./InvoiceView";
import { generateInvoicePdf } from "./generateInvoicePdf";
import { loadBillPdfData, saveBillPdf } from "./billPdf";

/**
 * Draws a stored bill off-screen and saves it as the bill's PDF. The PDF comes from the
 * browser so it matches the shop's bill layout, so the caller must render `offscreen`.
 */
export function useBillPdf() {
  const [view, setView] = useState(null);
  const viewRef = useRef(null);

  const generate = useCallback(async (billId) => {
    try {
      const { previousPdfUrl, view: loaded } = await loadBillPdfData(billId);
      flushSync(() => setView(loaded));
      if (!viewRef.current) throw new Error("Invoice ref missing");
      const blob = await generateInvoicePdf(viewRef.current);
      return await saveBillPdf({ billId, billNumber: loaded.billNumber, previousPdfUrl, blob });
    } finally {
      setView(null);
    }
  }, []);

  const offscreen = view && (
    <div
      style={{ position: "fixed", top: "-9999px", left: "-9999px", pointerEvents: "none" }}
      aria-hidden="true"
    >
      <InvoiceView ref={viewRef} {...view} />
    </div>
  );

  return { generate, offscreen };
}
