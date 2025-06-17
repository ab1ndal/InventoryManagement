import React from "react";
import ProductRow from "./ProductRow";

const ProductTable = ({ products, variants }) => {
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
        </tr>
      </thead>
      <tbody>
        {products.map((product) => (
          <ProductRow
            key={product.productid}
            product={product}
            variants={variants}
          />
        ))}
      </tbody>
    </table>
  );
};

export default ProductTable;
