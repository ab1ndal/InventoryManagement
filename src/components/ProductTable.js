import React from "react";
import ProductRow from "./ProductRow";
import { supabase } from "../supabaseClient";

const ProductTable = ({ products, variants, onProductUpdate }) => {
  const sortedProducts = [...products].sort((a, b) => {
    if (typeof a.productid === "string") {
      return a.productid.localeCompare(b.productid); // string-safe
    }
    return a.productid - b.productid;
  });

  const handleProductSave = async (updatedProduct) => {
    const { error } = await supabase
      .from("products")
      .update({
        name: updatedProduct.name,
        categoryid: updatedProduct.categoryid,
        fabric: updatedProduct.fabric,
        purchaseprice: updatedProduct.purchaseprice,
        retailprice: updatedProduct.retailprice,
        description: updatedProduct.description,
      })
      .eq("productid", updatedProduct.productid);

    if (error) {
      console.error("Supabase update error:", error.message);
      alert("Failed to save product");
    } else {
      alert("Product updated successfully");
      // optionally refresh data or mutate local state
    }
    if (onProductUpdate) onProductUpdate();
  };

  return (
    <table className="product-table">
      <thead>
        <tr>
          <th>Product ID</th>
          <th>Name</th>
          <th>Category</th>
          <th>Fabric</th>
          <th>Purchase Price</th>
          <th>Retail Price</th>
          <th>Markup (%)</th>
          <th>Sizes</th>
          <th>Colors</th>
          <th>Description</th>
          <th>Total Stock</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {sortedProducts.map((product) => (
          <ProductRow
            key={product.productid}
            product={product}
            variants={variants}
            onEdit={handleProductSave}
          />
        ))}
      </tbody>
    </table>
  );
};

export default ProductTable;
