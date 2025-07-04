import React, { useState } from "react";
import VariantRow from "./VariantRow";
import ChevronIcon from "./ChevronIcon";
import { Button } from "../../components/ui/button";
import ProductEditDialog from "./ProductEditDialog";

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

  const handleSave = async (updatedData) => {
    await onEdit(updatedData); // 🔁 Forward save back to parent
    setOpen(false); // 🔐 Close dialog after saving
  };

  return (
    <>
      <tr
        className="product-row"
        onClick={handleRowClick}
        style={{ cursor: "pointer" }}
      >
        <td>
          <ChevronIcon expanded={expanded} />
          {product.productid}
        </td>
        <td>
          {categories.find((cat) => cat.categoryid === product.categoryid)
            ?.name || "-"}
        </td>
        <td>{product.fabric}</td>
        <td style={{ textAlign: "right" }}>{formatINRCurrency(purchase)}</td>
        <td style={{ textAlign: "right" }}>{formatINRCurrency(retail)}</td>
        <td>{markup}%</td>
        <td>{uniqueSizes}</td>
        <td>{uniqueColors}</td>
        <td>{product.description}</td>
        <td style={{ textAlign: "right" }}>{formatStock(totalStock)}</td>
        <td>
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            Edit
          </Button>
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
        variants={sizeColorRows}
        categories={categories}
        onSave={handleSave}
      />
    </>
  );
};

export default ProductRow;
