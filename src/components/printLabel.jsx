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

// Generate TSPL string for 4cm x 2.5cm label
const generateTSPLLabel = (product) => {
  const purchaseCode = encodePriceToCode(Number(product.purchaseprice || 0));
  const retailPrice = `MRP: ₹${Number(product.retailprice || 0).toFixed(0)}`;

  const productId = product.productid;

  return `
SIZE 40 mm, 25 mm
GAP 2 mm, 0
DENSITY 8
SPEED 4
DIRECTION 1
REFERENCE 0,0
CLS

TEXT 10,10,"0",0,1,1,"BINDAL'S CREATION"
BARCODE 10,40,"128",40,1,0,2,2,"${productId}"
TEXT 10,90,"0",0,1,1,"${productId}"
TEXT 10,120,"0",0,1,1,"${purchaseCode}"
TEXT 180,120,"0",0,1,1,"${retailPrice}"

PRINT 1
`.trim();
};

// Send TSPL to printer via QZ Tray
const printLabel = async (product, printerName = "TSC TTP-244 Pro") => {
  const tspl = generateTSPLLabel(product);

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
        data: tspl,
      },
    ]);

    // Optionally disconnect after printing
    // await qz.websocket.disconnect();
  } catch (err) {
    console.error("Print failed:", err);
  }
};

export default printLabel;
