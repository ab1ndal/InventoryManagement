import React, {
  useImperativeHandle,
  forwardRef,
  useState,
  useEffect,
  useRef,
  useCallback,
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
    const keyCache = useRef(new Map());

    useImperativeHandle(ref, () => ({
      addProductToTable,
      updateProductInTable,
    }));

    const productIdSortKey = useCallback((id) => {
      const cache = keyCache.current;
      const cached = cache.get(id);
      if (cached) return cached;
      const m = /^BC(\d{2})(\d+)$/.exec(id);
      const key = m ? m[1] + m[2].padStart(6, "0") : "ZZ" + id;
      cache.set(id, key);
      return key;
    }, []);

    const fetchMatchingProductIds = useCallback(async () => {
      const batchSize = 1000;
      const allIds = new Set();
      let from = 0;
      let done = false;

      while (!done) {
        const { data, error } = await supabase
          .from("products")
          .select(
            "productid, categoryid, fabric, description, purchaseprice, retailprice"
          )
          .range(from, from + batchSize - 1);

        if (error || !data) break;

        for (const p of data) {
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

          const matchesPurchase =
            (filters.purchaseMin === "" ||
              p.purchaseprice >= Number(filters.purchaseMin)) &&
            (filters.purchaseMax === "" ||
              p.purchaseprice <= Number(filters.purchaseMax));

          const matchesRetail =
            (filters.retailMin === "" ||
              p.retailprice >= Number(filters.retailMin)) &&
            (filters.retailMax === "" ||
              p.retailprice <= Number(filters.retailMax));

          const discountPrice = p.purchaseprice * 1.3;
          const matchesDiscountPrice =
            (filters.discountPriceMin === "" ||
              discountPrice >= Number(filters.discountPriceMin)) &&
            (filters.discountPriceMax === "" ||
              discountPrice <= Number(filters.discountPriceMax));

          if (
            matchesProductId &&
            matchesFabric &&
            matchesDesc &&
            matchesCategory &&
            matchesPurchase &&
            matchesRetail &&
            matchesDiscountPrice
          ) {
            allIds.add(p.productid);
          }
        }

        if (data.length < batchSize) done = true;
        else from += batchSize;
      }

      if (
        filters.size ||
        filters.color ||
        filters.stockMin ||
        filters.stockMax
      ) {
        const stockMinNumber =
          filters.stockMin !== "" && filters.stockMin != null
            ? Number(filters.stockMin)
            : null;
        const stockMaxNumber =
          filters.stockMax !== "" && filters.stockMax != null
            ? Number(filters.stockMax)
            : null;
        const conditions = [];
        if (filters.size) conditions.push(`size.ilike.%${filters.size}%`);
        if (filters.color) conditions.push(`color.ilike.%${filters.color}%`);
        if (stockMinNumber !== null && !Number.isNaN(stockMinNumber))
          conditions.push(`stock.gte.${stockMinNumber}`);
        if (stockMaxNumber !== null && !Number.isNaN(stockMaxNumber))
          conditions.push(`stock.lte.${stockMaxNumber}`);
        if (conditions.length > 0) {
          const { data: variantMatches } = await supabase
            .from("productsizecolors")
            .select("productid")
            .or(conditions.join(","));

          if (variantMatches) {
            const matchingFromVariants = new Set(
              variantMatches.map((v) => v.productid)
            );
            for (const id of Array.from(allIds)) {
              if (!matchingFromVariants.has(id)) allIds.delete(id);
            }
          }
        }
      }

      return Array.from(allIds);
    }, [
      filters.productid,
      filters.fabric,
      filters.description,
      filters.category,
      filters.size,
      filters.color,
      categories,
      filters.discountPriceMin,
      filters.discountPriceMax,
      filters.purchaseMin,
      filters.purchaseMax,
      filters.retailMin,
      filters.retailMax,
      filters.stockMin,
      filters.stockMax,
    ]);

    const fetchPaginatedProducts = useCallback(
      async (productIds, page = 0) => {
        const uniqueIds = Array.from(new Set(productIds));
        const keyed = uniqueIds.map((id) => ({
          id,
          key: productIdSortKey(id),
        }));
        keyed.sort((a, b) => a.key.localeCompare(b.key));
        const sortedIds = keyed.map((x) => x.id);

        const idsForPage = sortedIds.slice(
          page * rowsPerPage,
          (page + 1) * rowsPerPage
        );
        if (idsForPage.length === 0) return { products: [], variants: [] };

        const { data: prods } = await supabase
          .from("products")
          .select("*")
          .in("productid", idsForPage);

        const { data: vars } = await supabase
          .from("productsizecolors")
          .select("*")
          .in("productid", idsForPage);

        const pos = new Map(idsForPage.map((id, i) => [id, i]));
        const byPageOrder = (a, b) =>
          (pos.get(a.productid) ?? 0) - (pos.get(b.productid) ?? 0);

        const prodsOrdered = (prods ?? []).slice().sort(byPageOrder);
        const varsOrdered = (vars ?? []).slice().sort(byPageOrder);

        return { products: prodsOrdered, variants: varsOrdered };
      },
      [rowsPerPage, productIdSortKey]
    );

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
    }, [filters, refreshFlag, fetchMatchingProductIds, fetchPaginatedProducts]);

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
    }, [currentPage, filteredProductIds, fetchPaginatedProducts]);

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
              <th>
                <div className="flex flex-col gap-1">
                  <Input
                    type="number"
                    step="any"
                    className={filterInputClass}
                    placeholder="Min"
                    value={filters.purchaseMin ?? ""}
                    onChange={(e) =>
                      setFilters({ ...filters, purchaseMin: e.target.value })
                    }
                  />
                  <Input
                    type="number"
                    step="any"
                    className={filterInputClass}
                    placeholder="Max"
                    value={filters.purchaseMax ?? ""}
                    onChange={(e) =>
                      setFilters({ ...filters, purchaseMax: e.target.value })
                    }
                  />
                </div>
              </th>

              <th>
                <div className="flex flex-col gap-1">
                  <Input
                    type="number"
                    step="any"
                    className={filterInputClass}
                    placeholder="Min"
                    value={filters.retailMin ?? ""}
                    onChange={(e) =>
                      setFilters({ ...filters, retailMin: e.target.value })
                    }
                  />
                  <Input
                    type="number"
                    step="any"
                    className={filterInputClass}
                    placeholder="Max"
                    value={filters.retailMax ?? ""}
                    onChange={(e) =>
                      setFilters({ ...filters, retailMax: e.target.value })
                    }
                  />
                </div>
              </th>

              <th></th>
              <th>
                <div className="flex flex-col gap-1">
                  <Input
                    type="number"
                    step="any"
                    className={filterInputClass}
                    placeholder="Min"
                    value={filters.discountPriceMin ?? ""}
                    onChange={(e) =>
                      setFilters({
                        ...filters,
                        discountPriceMin: e.target.value,
                      })
                    }
                  />
                  <Input
                    type="number"
                    step="any"
                    className={filterInputClass}
                    placeholder="Max"
                    value={filters.discountPriceMax ?? ""}
                    onChange={(e) =>
                      setFilters({
                        ...filters,
                        discountPriceMax: e.target.value,
                      })
                    }
                  />
                </div>
              </th>

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
              <th>
                <div className="flex flex-col gap-1">
                  <Input
                    type="number"
                    step={1}
                    min={0}
                    className={filterInputClass}
                    placeholder="Min"
                    value={filters.stockMin ?? ""}
                    onChange={(e) =>
                      setFilters({
                        ...filters,
                        stockMin: parseInt(e.target.value),
                      })
                    }
                  />
                  <Input
                    type="number"
                    step={1}
                    min={0}
                    className={filterInputClass}
                    placeholder="Max"
                    value={filters.stockMax ?? ""}
                    onChange={(e) =>
                      setFilters({
                        ...filters,
                        stockMax: parseInt(e.target.value),
                      })
                    }
                  />
                </div>
              </th>

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
