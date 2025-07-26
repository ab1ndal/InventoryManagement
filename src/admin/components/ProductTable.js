import React, {
  useImperativeHandle,
  forwardRef,
  useState,
  useEffect,
} from "react";
import ProductRow from "./ProductRow";
import { supabase } from "../../lib/supabaseClient";
import { useToast } from "../../components/hooks/use-toast";
import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";
import { Loader2 } from "lucide-react";

const ProductTable = forwardRef(
  (
    {
      categories,
      onProductUpdate,
      filters,
      setFilters,
      refreshFlag,
      onProductAdd,
    },
    ref
  ) => {
    const { toast } = useToast();

    const [currentPage, setCurrentPage] = useState(0);
    const [inputPage, setInputPage] = useState("1");
    const rowsPerPage = 15;
    const [products, setProducts] = useState([]);
    const [variants, setVariants] = useState([]);
    const [filteredProductIds, setFilteredProductIds] = useState([]);
    const [loading, setLoading] = useState(false);

    useImperativeHandle(ref, () => ({
      addProductToTable,
      updateProductInTable,
    }));

    const fetchMatchingProductIds = async () => {
      const batchSize = 1000;
      let allIds = new Set();
      let from = 0;
      let done = false;

      while (!done) {
        let query = supabase
          .from("products")
          .select("productid, categoryid, fabric, description")
          .range(from, from + batchSize - 1);

        const { data, error } = await query;
        if (error || !data) break;

        const filtered = data.filter((p) => {
          const matchesProductId = filters.productid
            ? p.productid
                .toLowerCase()
                .includes(filters.productid.toLowerCase())
            : true;
          const matchesFabric = filters.fabric
            ? (p.fabric || "")
                .toLowerCase()
                .includes(filters.fabric.toLowerCase())
            : true;
          const matchesDesc = filters.description
            ? (p.description || "")
                .toLowerCase()
                .includes(filters.description.toLowerCase())
            : true;
          const categoryName =
            categories.find((cat) => cat.categoryid === p.categoryid)?.name ||
            "";
          const matchesCategory = filters.category
            ? categoryName
                .toLowerCase()
                .includes(filters.category.toLowerCase())
            : true;

          return (
            matchesProductId && matchesFabric && matchesDesc && matchesCategory
          );
        });

        filtered.forEach((p) => allIds.add(p.productid));

        if (data.length < batchSize) done = true;
        else from += batchSize;
      }

      if (filters.size || filters.color) {
        const { data: variantMatches } = await supabase
          .from("productsizecolors")
          .select("productid")
          .or(
            [
              filters.size ? `size.ilike.%${filters.size}%` : "",
              filters.color ? `color.ilike.%${filters.color}%` : "",
            ]
              .filter(Boolean)
              .join(",")
          );

        if (variantMatches) {
          const matchingFromVariants = new Set(
            variantMatches.map((v) => v.productid)
          );
          allIds = new Set(
            [...allIds].filter((id) => matchingFromVariants.has(id))
          );
        }
      }

      return [...allIds];
    };

    const fetchPaginatedProducts = async (productIds, page = 0) => {
      const sortedIds = [...productIds].sort((a, b) => a.localeCompare(b));
      const idsForPage = sortedIds.slice(
        page * rowsPerPage,
        (page + 1) * rowsPerPage
      );
      const { data: prods } = await supabase
        .from("products")
        .select("*")
        .in("productid", idsForPage);
      const { data: vars } = await supabase
        .from("productsizecolors")
        .select("*")
        .in("productid", idsForPage);
      return { products: prods || [], variants: vars || [] };
    };

    useEffect(() => {
      const loadFilteredPaginated = async () => {
        setLoading(true);
        const matchingIds = await fetchMatchingProductIds();
        setFilteredProductIds(matchingIds);
        setCurrentPage(0);
        const { products: pageProducts, variants: pageVariants } =
          await fetchPaginatedProducts(matchingIds, 0);
        setProducts(pageProducts);
        setVariants(pageVariants);
        setLoading(false);
      };
      loadFilteredPaginated();
    }, [filters, refreshFlag]);

    useEffect(() => {
      const loadPage = async () => {
        setLoading(true);
        const { products: pageProducts, variants: pageVariants } =
          await fetchPaginatedProducts(filteredProductIds, currentPage);
        setProducts(pageProducts);
        setVariants(pageVariants);
        setLoading(false);
      };
      if (filteredProductIds.length > 0) loadPage();
    }, [currentPage]);

    useEffect(() => {
      setInputPage((currentPage + 1).toString());
    }, [currentPage]);

    const pageCount = Math.ceil(filteredProductIds.length / rowsPerPage);

    const filterInputClass =
      "h-7 text-xs border-gray-300 bg-muted text-gray-800 placeholder-gray-400 text-center";

    const handlePageInput = () => {
      const newPage = parseInt(inputPage) - 1;
      if (!isNaN(newPage) && newPage >= 0 && newPage < pageCount) {
        setCurrentPage(newPage);
      }
      setInputPage((currentPage + 1).toString());
    };

    const handleProductSave = async (updatedProduct, deletedVariants = []) => {
      try {
        const { variants: updatedVariants = [], ...productData } =
          updatedProduct;

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

        if (productError) throw new Error(productError.message);

        const upserts = updatedVariants
          .filter((v) => v.size && v.color)
          .map((v) => ({
            variantid: v.variantid || undefined,
            productid: productData.productid,
            size: v.size,
            color: v.color,
            stock: v.stock ?? 0,
          }));

        const { error: upsertError } = await supabase
          .from("productsizecolors")
          .upsert(upserts, { onConflict: ["variantid"] });

        if (upsertError) throw new Error(upsertError.message);

        await Promise.all(
          deletedVariants.map(async ({ variantid }) => {
            if (!variantid) return;
            const { error: deleteError } = await supabase
              .from("productsizecolors")
              .delete()
              .eq("variantid", variantid);
            if (deleteError) throw new Error(deleteError.message);
          })
        );

        updateProductInTable(productData, upserts, deletedVariants);

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
          description: error.message,
        });
      }
    };

    const addProductToTable = (newProduct, newVariants) => {
      setFilteredProductIds((prev) => {
        const newIds = [...prev, newProduct.productid];
        setCurrentPage(Math.floor((newIds.length - 1) / rowsPerPage)); // use new length
        return newIds;
      });
      setProducts((prev) => [...prev, newProduct]);
      setVariants((prev) => [...prev, ...newVariants]);

      if (onProductAdd) onProductAdd(newProduct.productid);
    };

    const updateProductInTable = (
      updatedProduct,
      updatedVariants,
      deletedVariants = []
    ) => {
      setProducts((prev) =>
        prev.map((p) =>
          p.productid === updatedProduct.productid ? updatedProduct : p
        )
      );
      setVariants((prev) => {
        const toDelete = new Set(deletedVariants.map((v) => v.variantid));
        const remaining = prev.filter(
          (v) =>
            v.productid !== updatedProduct.productid ||
            (v.variantid && !toDelete.has(v.variantid))
        );
        return [...remaining, ...updatedVariants];
      });
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
                  placeholder="Product ID"
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
              <th></th>
              <th></th>
              <th></th>
              <th></th>
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
              <th></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={12} className="text-center py-6">
                  <Loader2 className="h-5 w-5 mx-auto animate-spin text-muted-foreground" />
                </td>
              </tr>
            ) : (
              products.map((product) => (
                <ProductRow
                  key={product.productid}
                  product={product}
                  categories={categories}
                  variants={variants}
                  onEdit={handleProductSave}
                />
              ))
            )}
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
              onKeyDown={(e) => e.key === "Enter" && handlePageInput()}
            />
            <span>of {pageCount}</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage((p) => p + 1)}
            disabled={currentPage + 1 >= pageCount}
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
  }
);

export default ProductTable;
