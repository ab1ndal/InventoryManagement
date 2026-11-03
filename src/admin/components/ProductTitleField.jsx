import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "../../components/ui/form";
import { Input } from "../../components/ui/input";

const PREVIEW_DEBOUNCE_MS = 300;

// Staff type only the detail. The database builds the title, so this preview asks it rather than
// repeating the rule here. A failed preview must never stop someone saving a product.
export default function ProductTitleField({ form, productid }) {
  const [preview, setPreview] = useState(null);
  const fabric = form.watch("fabric");
  const categoryid = form.watch("categoryid");
  const detail = form.watch("title_detail");
  const variants = form.watch("variants");
  const colours = (variants || []).map((v) => v.color).filter(Boolean).join("\n");

  useEffect(() => {
    if (!detail?.trim()) {
      setPreview(null);
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const { data, error } = await supabase.rpc("preview_product_title", {
        p_fabric: fabric || null,
        p_categoryid: categoryid || null,
        p_detail: detail,
        p_colours: colours ? colours.split("\n") : null,
        p_exclude_productid: productid ?? null,
      });
      if (cancelled) return;
      if (error) console.warn("preview_product_title failed", { productid, message: error.message });
      setPreview(error ? null : data);
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [fabric, categoryid, detail, colours, productid]);

  return (
    <FormField
      control={form.control}
      name="title_detail"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Detail for website title (optional)</FormLabel>
          <FormControl>
            <Input {...field} value={field.value ?? ""} placeholder="e.g. Zari Embroidery, Mirror Work Border" />
          </FormControl>
          {preview && <p className="text-xs text-muted-foreground">Customers see: {preview.title}</p>}
          {preview?.duplicate && (
            <p role="alert" className="text-xs text-amber-700">
              Another product has this title. Add something specific, like the neckline or border.
            </p>
          )}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
