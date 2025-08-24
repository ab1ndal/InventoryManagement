// src/admin/pages/InventoryPage.js
import React, { useEffect, useState, useRef } from "react";
import { supabase } from "../../lib/supabaseClient";
import ProductTable from "../components/ProductTable";
import ProductEditDialog from "../components/ProductEditDialog";
import { Button } from "../../components/ui/button";
import { Toaster } from "../../components/ui/toaster";
import { useToast } from "../../components/hooks/use-toast";
// import styling
import "../../App.css";

const InventoryPage = () => {
  const [refreshFlag, setRefreshFlag] = useState(0);
  const [categories, setCategories] = useState([]);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const { toast } = useToast();
  const [filters, setFilters] = useState({
    productid: "",
    category: "",
    fabric: "",
    size: "",
    color: "",
    description: "",
  });
  const triggerRefresh = () => setRefreshFlag((prev) => prev + 1);
  const tableRef = useRef(null);

  useEffect(() => {
    fetchCategories();
  }, []);

  async function fetchCategories() {
    const { data, error } = await supabase.from("categories").select("*");
    if (!error) setCategories(data || []);
    //else console.log("error fetching categories: ", error);
  }

  function getYearPrefix(date = new Date()) {
    const yy = String(date.getFullYear()).slice(-2);
    return `BC${yy}`;
  }

  async function getNextProductId() {
    const prefix = getYearPrefix(); // "BC25"
    const { data: maxNum, error } = await supabase.rpc(
      "get_max_product_suffix",
      { p_prefix: prefix }
    );
    if (error) throw error;

    // maxNum is like 25999 for ID "BC25999"
    const yearDigits = prefix.slice(2); // "25"
    const maxStr = maxNum ? String(maxNum) : ""; // "25999" or ""
    const suffixNow = maxStr.startsWith(yearDigits)
      ? parseInt(maxStr.slice(yearDigits.length) || "0", 10)
      : 0;

    const nextSuffix = suffixNow + 1; // 1000 after 999
    const nextId = `${prefix}${String(nextSuffix).padStart(3, "0")}`;
    // After BC25999 this yields BC251000

    return nextId;
  }

  const handleAddProduct = async (newProductData) => {
    try {
      const { variants = [], ...productFields } = newProductData;
      const newProductId = await getNextProductId();

      const fullProduct = { ...productFields, productid: newProductId };
      const { error: insertErr } = await supabase
        .from("products")
        .insert([fullProduct])
        .select()
        .single();

      if (insertErr) throw new Error("Product insert failed");

      let variantData = [];

      if (variants.length) {
        variantData = variants.map((v) => ({
          ...v,
          productid: newProductId,
        }));

        const { error: varErr } = await supabase
          .from("productsizecolors")
          .insert(variantData);

        if (varErr) throw new Error("Variants insert failed");
      }

      if (tableRef.current?.addProductToTable) {
        tableRef.current.addProductToTable(fullProduct, variantData);
      }

      toast({
        title: `Product Added - ${fullProduct.productid}`,
        description: `Successfully added ${fullProduct.name}`,
      });
    } catch (err) {
      console.error(err);
      toast({
        variant: "destructive",
        title: "Adding Product Failed",
        description: err.message,
      });
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center m-4 gap-4">
        <Button onClick={() => setAddDialogOpen(true)}>+ Add Product</Button>
        <Button
          variant="secondary"
          onClick={() =>
            setFilters({
              productid: "",
              category: "",
              fabric: "",
              size: "",
              color: "",
              description: "",
            })
          }
        >
          Clear Filters
        </Button>
      </div>
      <ProductTable
        ref={tableRef}
        categories={categories}
        onProductUpdate={triggerRefresh}
        filters={filters}
        setFilters={setFilters}
        refreshFlag={refreshFlag}
        onProductAdd={(productid) => {
          console.log("Added product: ", productid);
        }}
      />
      <Toaster />
      <ProductEditDialog
        open={addDialogOpen}
        onClose={() => setAddDialogOpen(false)}
        product={{}}
        variants={[]}
        categories={categories}
        onSave={handleAddProduct}
      />
    </div>
  );
};

export default InventoryPage;
