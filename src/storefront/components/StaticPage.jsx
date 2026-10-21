import React from "react";
import Seo from "./Seo";

export default function StaticPage({
  title,
  seoTitle,
  seoDescription,
  containerClassName = "max-w-3xl",
  children,
}) {
  return (
    <div className="min-h-[60vh] bg-storefront-cream">
      <Seo title={seoTitle || title} description={seoDescription} />
      <div className={`${containerClassName} mx-auto px-4 sm:px-6 lg:px-8 py-14`}>
        <h1 className="font-display font-semibold text-4xl sm:text-5xl text-storefront-charcoal leading-tight mb-10">
          {title}
        </h1>
        {children}
      </div>
    </div>
  );
}
