import React from "react";
import HeroBanner from "../components/home/HeroBanner";
import CategoryShowcase from "../components/home/CategoryShowcase";
import NewArrivals from "../components/home/NewArrivals";
import FeaturedCollection from "../components/home/FeaturedCollection";
import BestsellerGrid from "../components/home/BestsellerGrid";
import TrustBar from "../components/home/TrustBar";
import Seo from "../components/Seo";

export default function HomePage() {
  return (
    <>
      <Seo description="Handcrafted sarees, lehengas, and ethnic wear from Bindal's Creations — rooted in tradition, crafted with love." />
      <HeroBanner />
      <TrustBar />
      <CategoryShowcase />
      <NewArrivals />
      <FeaturedCollection />
      <BestsellerGrid />
    </>
  );
}
