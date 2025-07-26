import React, { useState } from "react";
import VariantRow from "./VariantRow";
import ChevronIcon from "./ChevronIcon";
import ProductEditDialog from "./ProductEditDialog";
import { EditButton, PrintButton } from "../../components/ActionButtons";
import printLabel from "../../components/printLabel";

const ProductRow = ({ product, variants, onEdit, categories }) => {
  const [expanded, setExpanded] = useState(false);
  const [open, setOpen] = useState(false);

  const sizeColorRows = variants.filter(
    (v) => v.productid === product.productid
  );
  const totalStock = sizeColorRows.reduce(
    (sum, row) => sum + (row.stock || 0),
    0
  );

  const formatStock = (value) => {
    if (isNaN(value)) return "0 pcs";
    return `${Number(value).toLocaleString("en-IN")} pcs`;
  };

  const formatINRCurrency = (value) => {
    if (isNaN(value)) return "₹0";
    return `₹${Number(value).toLocaleString("en-IN")}`;
  };

  const purchase = product.purchaseprice || 0;
  const retail = product.retailprice || 0;
  const markup =
    purchase > 0 ? (((retail - purchase) / purchase) * 100).toFixed(1) : "N/A";

  const uniqueSizes = [...new Set(sizeColorRows.map((row) => row.size))].join(
    ", "
  );
  const uniqueColors = [...new Set(sizeColorRows.map((row) => row.color))].join(
    ", "
  );

  const handleRowClick = () => {
    setExpanded((prev) => !prev);
  };

  const handleSave = async (updatedData, deletedVariants) => {
    await onEdit(updatedData, deletedVariants); // 🔁 Forward save back to parent
    setOpen(false); // 🔐 Close dialog after saving
  };

  const encodedPriceToCode = (price) => {
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

  const getDiscountInfo = (purchasePrice, retailPrice) => {
    const discountedPrice = +(purchasePrice * 1.3).toFixed(2);
    const discountPct = retailPrice
      ? +(((retailPrice - discountedPrice) / retailPrice) * 100).toFixed(0)
      : 0;
    return { discountedPrice, discountPct };
  };

  return (
    <>
      <tr
        className="product-row"
        onClick={handleRowClick}
        style={{ cursor: "pointer" }}
      >
        <td style={{ textAlign: "center" }}>
          <ChevronIcon expanded={expanded} />
          {product.productid}
        </td>
        <td style={{ textAlign: "center" }}>
          {categories.find((cat) => cat.categoryid === product.categoryid)
            ?.name || "-"}
        </td>
        <td style={{ textAlign: "center" }}>{product.fabric}</td>
        <td style={{ textAlign: "center" }}>
          {formatINRCurrency(purchase)}
          <br />
          <span className="text-xs text-gray-500">
            ({encodedPriceToCode(purchase)})
          </span>
        </td>
        <td style={{ textAlign: "center" }}>{formatINRCurrency(retail)}</td>
        <td style={{ textAlign: "center" }}>{markup}%</td>
        <td style={{ textAlign: "center" }}>
          {formatINRCurrency(getDiscountInfo(purchase, retail).discountedPrice)}
          <br />
          <span className="text-xs text-gray-500">
            ({getDiscountInfo(purchase, retail).discountPct}% Off)
          </span>
        </td>
        <td>{uniqueSizes}</td>
        <td>{uniqueColors}</td>
        <td>{product.description}</td>
        <td style={{ textAlign: "center" }}>{formatStock(totalStock)}</td>
        <td>
          <EditButton onClick={() => setOpen(true)} />
          <PrintButton onClick={() => printLabel(product)} />
        </td>
      </tr>

      {expanded &&
        sizeColorRows.map((row, index) => (
          <VariantRow
            key={`${product.productid}-${index}`}
            row={row}
            colSpan={12}
          />
        ))}

      <ProductEditDialog
        open={open}
        onClose={() => setOpen(false)}
        product={product}
        variants={sizeColorRows.map((v) => ({
          ...v,
          variantid: v.variantid || crypto.randomUUID(),
        }))}
        categories={categories}
        onSave={handleSave}
      />
    </>
  );
};

export default ProductRow;
