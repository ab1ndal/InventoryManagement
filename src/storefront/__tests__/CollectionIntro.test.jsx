import React from "react";
import { render } from "@testing-library/react";
import CollectionIntro from "../components/shop/CollectionIntro";
import { COLLECTIONS } from "../lib/collections";
import { describePage } from "../../seoRender/pages";

const withIntro = COLLECTIONS.filter((c) => c.intro);
const textOf = (html) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();

describe("CollectionIntro", () => {
  it("shows the lead and puts the rest in a closed details with the collection's name", () => {
    const { container } = render(<CollectionIntro title="Sarees" intro={{ lead: "Lead text.", more: ["One.", "Two."] }} />);
    const details = container.querySelector("details");
    expect(details.open).toBe(false);
    expect(details.querySelector("summary")).toHaveTextContent("More about Sarees");
    expect(container).toHaveTextContent("Lead text.");
    expect(details.querySelectorAll("p")).toHaveLength(2);
  });

  it.each(withIntro.map((c) => [c.slug, c]))("%s: the server HTML carries the same words as the app", async (slug, c) => {
    const { container } = render(<CollectionIntro title={c.title} intro={c.intro} />);
    const page = await describePage(`collections/${slug}`, () => Promise.resolve([]));
    const intro = page.bodyHtml.match(/<\/p>(<p>.*<\/details>)/)[1];
    expect(textOf(intro)).toBe(textOf(container.innerHTML));
    expect(page.bodyHtml).toContain(`<summary>More about ${c.title.replace("&", "&amp;")}</summary>`);
  });
});
