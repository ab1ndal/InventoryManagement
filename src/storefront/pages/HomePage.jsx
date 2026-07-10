import React from "react";
import HeroBanner from "../components/home/HeroBanner";
import CategoryShowcase from "../components/home/CategoryShowcase";
import NewArrivals from "../components/home/NewArrivals";
import FeaturedCollection from "../components/home/FeaturedCollection";
import BestsellerGrid from "../components/home/BestsellerGrid";
import TrustBar from "../components/home/TrustBar";

export default function HomePage() {
  return (
    <>
      <HeroBanner />
      <TrustBar />
      <CategoryShowcase />
      <NewArrivals />
      <FeaturedCollection />
      <BestsellerGrid />
    </>
  );
}
