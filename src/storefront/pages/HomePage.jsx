import React from "react";
import CategoryBand from "../components/home/CategoryBand";
import HeroSlider from "../components/home/HeroSlider";
import OfferBand from "../components/home/OfferBand";
import DiwaliRail from "../components/home/DiwaliRail";
import TailoringBand from "../components/home/TailoringBand";
import NewArrivals from "../components/home/NewArrivals";
import CategoryRail from "../components/home/CategoryRail";
import TrustBar from "../components/home/TrustBar";
import BrandStory from "../components/home/BrandStory";
import Seo from "../components/Seo";
import { HOME_DESCRIPTION, HOME_TITLE } from "../lib/seoText";
import { CATEGORY_RAILS } from "../lib/homeRails";

export default function HomePage() {
  return (
    <>
      <Seo title={HOME_TITLE} description={HOME_DESCRIPTION} />
      <h1 className="sr-only">Bindal's Creation: handpicked Indian ethnic wear and custom tailoring</h1>
      <CategoryBand />
      <HeroSlider />
      <OfferBand />
      <DiwaliRail />
      <TailoringBand />
      <NewArrivals />
      {CATEGORY_RAILS.map((rail, i) => (
        <CategoryRail
          key={rail.slug}
          slug={rail.slug}
          title={rail.title}
          maxPrice={rail.maxPrice}
          tone={i % 2 === 0 ? "white" : "cream"}
        />
      ))}
      <TrustBar />
      <BrandStory />
    </>
  );
}
