// src/admin/pages/InventoryPage.js
import React, { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import ProductTable from "../components/ProductTable";
import ProductEditDialog from "../components/ProductEditDialog";
import { Button } from "../../components/ui/button";
import { Toaster } from "../../components/ui/toaster";
import { useToast } from "../../components/hooks/use-toast";
// import styling
import "../../App.css";

const InventoryPage = () => {
  const [products, setProducts] = useState([]);
  const [productsSizeColors, setProductsSizeColors] = useState([]);
  const [categories, setCategories] = useState([]);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetchProducts();
    fetchProductsSizeColors();
    fetchCategories();
  }, []);

  async function fetchProducts() {
    const { data, error } = await supabase.from("products").select("*");
    if (!error) setProducts(data || []);
    else console.log("error fetching products: ", error);
  }

  async function fetchProductsSizeColors() {
    const { data, error } = await supabase
      .from("productsizecolors")
      .select("*");
    if (!error) setProductsSizeColors(data || []);
    else console.log("error fetching products size colors: ", error);
  }

  async function fetchCategories() {
    const { data, error } = await supabase.from("categories").select("*");
    if (!error) setCategories(data || []);
    else console.log("error fetching categories: ", error);
  }

  const handleProductUpdate = async () => {
    await fetchProducts();
    await fetchProductsSizeColors();
  };

  const handleAddProduct = async (newProductData) => {
    try {
      const { variants = [], ...productFields } = newProductData;

      const { data: existing, error: fetchErr } = await supabase
        .from("products")
        .select("productid")
        .like("productid", "BC25%");

      if (fetchErr) throw new Error("Failed to fetch product IDs");

      const maxId = existing
        .map((p) => parseInt(p.productid?.replace("BC25", "") || 0, 10))
        .filter((n) => !isNaN(n))
        .reduce((a, b) => Math.max(a, b), 0);

      const newNumericPart = (maxId + 1).toString().padStart(3, "0");
      const newProductId = `BC25${newNumericPart}`;

      const fullProduct = { ...productFields, productid: newProductId };
      const { error: insertErr } = await supabase
        .from("products")
        .insert([fullProduct])
        .select()
        .single();

      if (insertErr) throw new Error("Product insert failed");

      if (variants.length) {
        const variantData = variants.map((v) => ({
          ...v,
          productid: newProductId,
        }));

        const { error: varErr } = await supabase
          .from("productsizecolors")
          .insert(variantData);

        if (varErr) throw new Error("Variants insert failed");
      }

      await handleProductUpdate();
      toast({
        title: "Product Added",
        description: `Successfully added ${fullProduct.name}`,
      });
    } catch (err) {
      console.error(err);
      toast({
        variant: "destructive",
        title: "Add Failed",
        description: err.message,
      });
    }
  };

  return (
    <div>
      <Button className="m-4" onClick={() => setAddDialogOpen(true)}>
        + Add Product
      </Button>
      <ProductTable
        products={products}
        variants={productsSizeColors}
        categories={categories}
        onProductUpdate={handleProductUpdate}
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
