import qz from "qz-tray";

// Encode numeric price using custom code system: 1 = A, 0 = Z, etc.
const encodePriceToCode = (price) => {
  const map = {
    1: "A",
    2: "B",
    3: "C",
    4: "D",
    5: "E",
    6: "F",
    7: "G",
    8: "H",
    9: "I",
    0: "Z",
  };
  return (
    "Z" +
    price
      .toString()
      .split("")
      .map((d) => map[d])
      .join("")
  );
};

// Generate ZPL string for 4cm x 2.5cm label
const generateZPLLabel = (product) => {
  const purchaseCode = encodePriceToCode(product.purchaseprice);
  const retailPrice = `MRP: ₹${product.retailprice.toFixed(0)}`;
  const productId = product.productid;

  return `
^XA
^PW640
^LL320
^CF0,30
^FO20,10^FDBINDAL'S CREATION^FS

^BY2,2,60
^FO20,50^BCN,60,N,N,N^FD${productId}^FS

^CF0,35
^FO20,120^FD${productId}^FS

^CF0,30
^FO20,160^FD${purchaseCode}^FS
^FO300,160^FD${retailPrice}^FS
^XZ
  `.trim();
};

// Send ZPL to printer via QZ Tray
const printLabel = async (product, printerName = "Save as PDF") => {
  const zpl = generateZPLLabel(product);

  try {
    // Connect only if not already active
    if (!qz.websocket.isActive()) {
      await qz.websocket.connect();
    }

    // Get list of all printers once
    const allPrinters = await qz.printers.find();
    console.log("All available printers:", allPrinters);

    const selectedPrinter = allPrinters.includes(printerName)
      ? printerName
      : allPrinters[0]; // fallback to default if not found

    console.log("Using printer:", selectedPrinter);

    const config = qz.configs.create(selectedPrinter);

    await qz.print(config, [
      {
        type: "raw",
        format: "plain",
        data: zpl,
      },
    ]);

    // Optionally disconnect after printing
    // await qz.websocket.disconnect();
  } catch (err) {
    console.error("Print failed:", err);
  }
};

export default printLabel;
