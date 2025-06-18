import React from "react";
import ProductRow from "./ProductRow";
import { supabase } from "../supabaseClient";
import { useToast } from "../components/hooks/use-toast";

const ProductTable = ({ products, variants, onProductUpdate }) => {
  const { toast } = useToast();

  const sortedProducts = [...products].sort((a, b) => {
    if (typeof a.productid === "string") {
      return a.productid.localeCompare(b.productid);
    }
    return a.productid - b.productid;
  });

  const handleProductSave = async (updatedProduct) => {
    try {
      const { variants: updatedVariants = [], ...productData } = updatedProduct;

      // 1. Update product info
      const { error: productError } = await supabase
        .from("products")
        .update({
          name: productData.name,
          categoryid: productData.categoryid,
          fabric: productData.fabric,
          purchaseprice: productData.purchaseprice,
          retailprice: productData.retailprice,
          description: productData.description,
        })
        .eq("productid", productData.productid);

      if (productError) {
        throw new Error(`Failed to update product: ${productError.message}`);
      }

      // 2. Fetch existing variants
      const { data: existingVariants = [], error: fetchError } = await supabase
        .from("productsizecolors")
        .select("*")
        .eq("productid", productData.productid);

      if (fetchError) {
        throw new Error(
          `Failed to fetch existing variants: ${fetchError.message}`
        );
      }

      // 3. Create maps for comparison
      const key = (v) => `${v?.size || ""}-${v?.color || ""}`;
      const existingMap = new Map(existingVariants.map((v) => [key(v), v]));
      const updatedMap = new Map(updatedVariants.map((v) => [key(v), v]));

      // 4. Upsert new or changed variants
      const upserts = updatedVariants.map((v) => ({
        ...v,
        productid: productData.productid,
      }));

      const { error: upsertError } = await supabase
        .from("productsizecolors")
        .upsert(upserts, { onConflict: ["productid", "size", "color"] });

      if (upsertError) {
        throw new Error(`Failed to upsert variants: ${upsertError.message}`);
      }

      // 5. Delete removed variants
      const toDelete = Array.from(existingMap.keys()).filter(
        (k) => !updatedMap.has(k)
      );

      for (const delKey of toDelete) {
        const [size, color] = delKey.split("-");
        const { error: deleteError } = await supabase
          .from("productsizecolors")
          .delete()
          .eq("productid", productData.productid)
          .eq("size", size)
          .eq("color", color);

        if (deleteError) {
          throw new Error(`Failed to delete variant: ${deleteError.message}`);
        }
      }

      if (onProductUpdate) await onProductUpdate();
      toast({
        title: "Product Updated",
        description: `Saved changes to ${productData.name}`,
      });
    } catch (error) {
      console.error("Product update error:", error);
      toast({
        variant: "destructive",
        title: "Update Failed",
        description: error.message || "Could not update product",
      });
    }
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
