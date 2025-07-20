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
  const [inputPage, setInputPage] = useState((currentPage + 1).toString());
  const rowsPerPage = 15;

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

  const handleProductSave = async (updatedProduct, deletedVariants = []) => {
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

      // 2. Upsert variants using variantid
      const upserts = (updatedVariants ?? [])
        .filter((v) => v.size && v.color)
        .map((v) => ({
          variantid: v.variantid || undefined, // Preserve variantid if present
          productid: productData.productid,
          size: v.size,
          color: v.color,
          stock: v.stock ?? 0,
        }));

      const { error: upsertError } = await supabase
        .from("productsizecolors")
        .upsert(upserts, { onConflict: ["variantid"] });

      if (upsertError) {
        throw new Error(`Failed to upsert variants: ${upsertError.message}`);
      }

      // 3. Delete removed variants by variantid
      await Promise.all(
        deletedVariants.map(async ({ variantid }) => {
          if (!variantid) return;
          const { error: deleteError } = await supabase
            .from("productsizecolors")
            .delete()
            .eq("variantid", variantid);

          if (deleteError) {
            throw new Error(`Failed to delete variant: ${deleteError.message}`);
          }
        })
      );

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

  useEffect(() => {
    setInputPage((currentPage + 1).toString());
  }, [currentPage]);

  const filterInputClass =
    "h-7 text-xs border-gray-300 bg-muted text-gray-800 placeholder-gray-400 text-center";

  const handlePageInput = () => {
    const newPage = parseInt(inputPage) - 1;
    if (!isNaN(newPage) && newPage >= 0 && newPage < pageCount) {
      setCurrentPage(newPage);
    }
    setInputPage((currentPage + 1).toString()); // reset to valid current page
  };
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
      <div className="flex justify-center items-center gap-2 py-4 flex-wrap text-sm text-gray-600">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCurrentPage(0)}
          disabled={currentPage === 0}
        >
          First
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCurrentPage((p) => Math.max(p - 1, 0))}
          disabled={currentPage === 0}
        >
          Previous
        </Button>
        <div className="flex items-center gap-2">
          <span>Page</span>
          <Input
            type="number"
            className="h-7 w-16 text-center text-sm"
            min={1}
            max={pageCount}
            value={inputPage}
            onChange={(e) => setInputPage(e.target.value)}
            onBlur={handlePageInput}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handlePageInput();
              }
            }}
          />
          <span>of {pageCount}</span>
        </div>
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
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCurrentPage(pageCount - 1)}
          disabled={currentPage === pageCount - 1}
        >
          Last
        </Button>
      </div>
    </div>
  );
};

export default ProductTable;
