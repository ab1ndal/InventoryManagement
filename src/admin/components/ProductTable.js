import React, { useState, useMemo, useEffect } from "react";
import ProductRow from "./ProductRow";
import { supabase } from "../../lib/supabaseClient";
import { useToast } from "../../components/hooks/use-toast";
import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";

const ProductTable = ({ products, variants, categories, onProductUpdate }) => {
  const { toast } = useToast();
  const [filters, setFilters] = useState({
    productid: "",
    category: "",
    fabric: "",
    size: "",
    color: "",
    description: "",
  });

  const [currentPage, setCurrentPage] = useState(0);
  const rowsPerPage = 10;

  const filteredProducts = useMemo(() => {
    const result = products.filter((product) => {
      const relatedVariants = variants.filter(
        (v) => v.productid === product.productid
      );
      const hasMatchingSize = filters.size
        ? relatedVariants.some((v) =>
            (v.size || "").toLowerCase().includes(filters.size.toLowerCase())
          )
        : true;
      const hasMatchingColor = filters.color
        ? relatedVariants.some((v) =>
            (v.color || "").toLowerCase().includes(filters.color.toLowerCase())
          )
        : true;

      return (
        product.productid
          .toLowerCase()
          .includes(filters.productid.toLowerCase()) &&
        (
          categories.find((cat) => cat.categoryid === product.categoryid)
            ?.name || ""
        )
          .toLowerCase()
          .includes(filters.category.toLowerCase()) &&
        (product.fabric || "")
          .toLowerCase()
          .includes(filters.fabric.toLowerCase()) &&
        (product.description || "")
          .toLowerCase()
          .includes(filters.description.toLowerCase()) &&
        hasMatchingSize &&
        hasMatchingColor
      );
    });

    // ✅ Sort the filtered result
    return [...result].sort((a, b) => {
      if (typeof a.productid === "string") {
        return a.productid.localeCompare(b.productid);
      }
      return a.productid - b.productid;
    });
  }, [products, variants, filters]);

  const paginatedProducts = useMemo(() => {
    const startIndex = currentPage * rowsPerPage;
    return filteredProducts.slice(startIndex, startIndex + rowsPerPage);
  }, [filteredProducts, currentPage]);

  const pageCount = Math.ceil(filteredProducts.length / rowsPerPage);

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
          producturl: productData.producturl,
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

  useEffect(() => {
    setCurrentPage(0);
  }, [filters]);
  const filterInputClass =
    "h-7 text-xs border-gray-300 bg-muted text-gray-800 placeholder-gray-400 text-center";

  return (
    <div className="overflow-x-auto">
      <table className="product-table">
        <thead>
          <tr>
            <th className="w-32 text-center">Product ID</th>
            <th className="w-40 text-center">Category</th>
            <th className="w-32 text-center">Fabric</th>
            <th className="w-24 text-center">Purchase Price</th>
            <th className="w-24 text-center">Retail Price</th>
            <th className="w-24 text-center">Markup (%)</th>
            <th className="w-24 text-center">Max Discount Price</th>
            <th className="w-32 text-center">Sizes</th>
            <th className="w-32 text-center">Colors</th>
            <th className="w-64 text-center">Description</th>
            <th className="w-28 text-center">Total Stock</th>
            <th className="w-28 text-center">Actions</th>
          </tr>
          <tr>
            <th>
              <Input
                className={filterInputClass}
                placeholder="ID"
                value={filters.productid}
                onChange={(e) =>
                  setFilters({ ...filters, productid: e.target.value })
                }
              />
            </th>
            <th>
              <Input
                className={filterInputClass}
                placeholder="Category"
                value={filters.category}
                onChange={(e) =>
                  setFilters({ ...filters, category: e.target.value })
                }
              />
            </th>
            <th>
              <Input
                className={filterInputClass}
                placeholder="Fabric"
                value={filters.fabric}
                onChange={(e) =>
                  setFilters({ ...filters, fabric: e.target.value })
                }
              />
            </th>
            <th colSpan={4}></th>
            <th>
              <Input
                className={filterInputClass}
                placeholder="Size"
                value={filters.size}
                onChange={(e) =>
                  setFilters({ ...filters, size: e.target.value })
                }
              />
            </th>
            <th>
              <Input
                className={filterInputClass}
                placeholder="Color"
                value={filters.color}
                onChange={(e) =>
                  setFilters({ ...filters, color: e.target.value })
                }
              />
            </th>
            <th>
              <Input
                className={filterInputClass}
                placeholder="Description"
                value={filters.description}
                onChange={(e) =>
                  setFilters({ ...filters, description: e.target.value })
                }
              />
            </th>
            <th colSpan={2}></th>
          </tr>
        </thead>

        <tbody>
          {paginatedProducts.map((product) => (
            <ProductRow
              key={product.productid}
              product={product}
              categories={categories}
              variants={variants}
              onEdit={handleProductSave}
            />
          ))}
        </tbody>
      </table>
      <div className="flex justify-center items-center gap-4 py-4">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCurrentPage((p) => Math.max(p - 1, 0))}
          disabled={currentPage === 0}
        >
          Previous
        </Button>
        <span className="text-sm text-gray-600">
          Page {currentPage + 1} of {pageCount}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            setCurrentPage((p) =>
              (p + 1) * rowsPerPage >= filteredProducts.length ? p : p + 1
            )
          }
          disabled={(currentPage + 1) * rowsPerPage >= filteredProducts.length}
        >
          Next
        </Button>
      </div>
    </div>
  );
};

export default ProductTable;
