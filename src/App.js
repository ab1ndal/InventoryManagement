import React, { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import ProductTable from "./components/ProductTable";
import { Toaster } from "./components/ui/toaster";
import "./App.css";

const App = () => {
  const [products, setProducts] = useState([]);
  const [productsSizeColors, setProductsSizeColors] = useState([]);
  const [categories, setCategories] = useState([]);

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

  return (
    <>
      <ProductTable
        products={products}
        variants={productsSizeColors}
        categories={categories}
        onProductUpdate={handleProductUpdate}
      />
      <Toaster />
    </>
  );
};

export default App;
