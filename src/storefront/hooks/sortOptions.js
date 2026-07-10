export const SORT_OPTIONS = [
  { value: "newest", label: "Newest" },
  { value: "price_asc", label: "Price: Low to High" },
  { value: "price_desc", label: "Price: High to Low" },
];

// Maps a sort selection to a Supabase .order() clause.
export function sortOrderClause(sortBy) {
  switch (sortBy) {
    case "price_asc":
      return { column: "retailprice", ascending: true };
    case "price_desc":
      return { column: "retailprice", ascending: false };
    case "newest":
    default:
      return { column: "productid", ascending: false };
  }
}
