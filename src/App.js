import React, { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import ProductTable from "./components/ProductTable";
import "./App.css";

const App = () => {
  const [products, setProducts] = useState([]);
  const [productsSizeColors, setProductsSizeColors] = useState([]);

  useEffect(() => {
    fetchProducts();
    fetchProductsSizeColors();
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

  return (
    <ProductTable
      products={products}
      variants={productsSizeColors}
      onProductUpdate={fetchProducts}
    />
  );
};

export default App;
