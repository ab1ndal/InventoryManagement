import React from "react";
import CategoryBand from "../components/home/CategoryBand";
import HeroSlider from "../components/home/HeroSlider";
import DiwaliRail from "../components/home/DiwaliRail";
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
      <Seo description="Handpicked sarees, lehengas, and ethnic wear from Bindal's Creation — rooted in tradition, curated with care." />
      <h1 className="sr-only">Bindal's Creation — handpicked Indian ethnic wear</h1>
      <CategoryBand />
      <HeroSlider />
      <DiwaliRail />
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
