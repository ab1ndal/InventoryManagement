import React from "react";
import CategoryBand from "../components/home/CategoryBand";
import HeroSlider from "../components/home/HeroSlider";
import DiwaliRail from "../components/home/DiwaliRail";
import TailoringBand from "../components/home/TailoringBand";
import NewArrivals from "../components/home/NewArrivals";
import CategoryRail from "../components/home/CategoryRail";
import TrustBar from "../components/home/TrustBar";
import BrandStory from "../components/home/BrandStory";
import Seo from "../components/Seo";

// Products first: category shortcuts and the hero, then product rails;
// reassurance and the brand story come after the products.
const CATEGORY_RAILS = [
  { slug: "sarees", title: "Sarees" },
  { slug: "lehengas", title: "Lehengas" },
  { slug: "kurtis", title: "Kurtis" },
  { slug: "everyday", title: "Everyday" },
  { slug: "sherwani", title: "Sherwani" },
  { slug: "kurta-pajama", title: "Kurta Pajama" },
];

export default function HomePage() {
  return (
    <>
      <Seo description="Handpicked sarees, lehengas, suits and sherwanis from Bindal's Creation in Ghaziabad. Seen a look you love? Our in-house tailors can make it for you." />
      <h1 className="sr-only">Bindal's Creation: handpicked Indian ethnic wear and custom tailoring</h1>
      <CategoryBand />
      <HeroSlider />
      <DiwaliRail />
      <TailoringBand />
      <NewArrivals />
      {CATEGORY_RAILS.map((rail, i) => (
        <CategoryRail
          key={rail.slug}
          slug={rail.slug}
          title={rail.title}
          tone={i % 2 === 0 ? "white" : "cream"}
        />
      ))}
      <TrustBar />
      <BrandStory />
    </>
  );
}
