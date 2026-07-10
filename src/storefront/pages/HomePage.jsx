import React from "react";
import HeroBanner from "../components/home/HeroBanner";
import TrustBar from "../components/home/TrustBar";
import CategoryShowcase from "../components/home/CategoryShowcase";
import NewArrivals from "../components/home/NewArrivals";
import BrandStory from "../components/home/BrandStory";
import Seo from "../components/Seo";

export default function HomePage() {
  return (
    <>
      <Seo description="Handcrafted sarees, lehengas, and ethnic wear from Bindal's Creations — rooted in tradition, crafted with love." />
      <HeroBanner />
      <TrustBar />
      <CategoryShowcase />
      <NewArrivals />
      <BrandStory />
    </>
  );
}
