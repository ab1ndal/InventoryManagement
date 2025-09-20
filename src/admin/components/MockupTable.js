// src/admin/components/MockupTable.js
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import MockupRow from "./MockupRow";
import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";
import { Loader2 } from "lucide-react";
import { useToast } from "../../components/hooks/use-toast";

const ROWS_PER_PAGE = 100;

export default function MockupTable({ canEdit }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const [inputPage, setInputPage] = useState("1");
  const [stats, setStats] = useState(null);

  const [filters, setFilters] = useState({
    productid: "",
    category: "",
    fabric: "",
    size: "",
    color: "",
    redo: "All",
    base_mockup: "All",
    file_mockup: "All",
    mockup: "All",
    video: "All",
    ig_post: "All",
    ig_reel: "All",
    whatsapp: "All",
  });

  const filterString = JSON.stringify(filters);

  // reset to first page when filters change
  useEffect(() => {
    setCurrentPage(0);
  }, [filterString]);

  const pageCount = useMemo(
    () => Math.max(1, Math.ceil(totalCount / ROWS_PER_PAGE)),
    [totalCount]
  );

  useEffect(() => {
    setInputPage(String(currentPage + 1));
  }, [currentPage]);

useEffect(() => {
  const run = async () => {
    setLoading(true);
    try {
      // start building query
      let baseQuery = supabase.from("mockups_view");

      // apply filters to row query
      const applyFilters = (q) => {
        if (filters.productid)
          q = q.ilike("productid", `%${filters.productid}%`);
        if (filters.category) q = q.ilike("category", `%${filters.category}%`);
        if (filters.fabric) q = q.ilike("fabric", `%${filters.fabric}%`);
        if (filters.size) q = q.ilike("sizes", `%${filters.size}%`);
        if (filters.color) q = q.ilike("colors", `%${filters.color}%`);

        [
          "redo",
          "base_mockup",
          "file_mockup",
          "mockup",
          "video",
          "ig_post",
          "ig_reel",
          "whatsapp",
        ].forEach((field) => {
          const val = (filters[field] || "").toLowerCase();
          if (val === "true") q = q.eq(field, true);
          if (val === "false") q = q.eq(field, false);
        });
        return q;
      };

      // add ordering and pagination
      const from = currentPage * ROWS_PER_PAGE;
      const to = from + ROWS_PER_PAGE - 1;

      let rowQuery = applyFilters(
        baseQuery
          .select("*", { count: "exact" })
          .order("year_code", { ascending: true })
          .order("product_num", { ascending: true })
          .range(from, to)
      );

      // run both queries in parallel: rows + stats RPC
      const [
        { data: rowData, error: rowErr, count },
        { data: statsData, error: statsErr },
      ] = await Promise.all([
        rowQuery,
        supabase
          .rpc("mockups_stats_filtered", {
            _productid: filters.productid || null,
            _category: filters.category || null,
            _fabric: filters.fabric || null,
            _size: filters.size || null,
            _color: filters.color || null,
            _redo:
              filters.redo === "true"
                ? true
                : filters.redo === "false"
                ? false
                : null,
            _base_mockup:
              filters.base_mockup === "true"
                ? true
                : filters.base_mockup === "false"
                ? false
                : null,
            _file_mockup:
              filters.file_mockup === "true"
                ? true
                : filters.file_mockup === "false"
                ? false
                : null,
            _mockup:
              filters.mockup === "true"
                ? true
                : filters.mockup === "false"
                ? false
                : null,
            _video:
              filters.video === "true"
                ? true
                : filters.video === "false"
                ? false
                : null,
            _ig_post:
              filters.ig_post === "true"
                ? true
                : filters.ig_post === "false"
                ? false
                : null,
            _ig_reel:
              filters.ig_reel === "true"
                ? true
                : filters.ig_reel === "false"
                ? false
                : null,
            _whatsapp:
              filters.whatsapp === "true"
                ? true
                : filters.whatsapp === "false"
                ? false
                : null,
          })
          .single(),
      ]);

      if (rowErr) throw new Error(rowErr.message);
      if (statsErr) throw new Error(statsErr.message);

      setRows(rowData || []);
      setTotalCount(count || 0);
      setStats(statsData || null);
    } catch (err) {
      console.error(err);
      toast({
        variant: "destructive",
        title: "Load failed",
        description: err.message,
      });
    } finally {
      setLoading(false);
    }
  };

  run();
}, [currentPage, filters, toast]);


  const onToggle = async (productid, field, value) => {
    try {
      const patch = { [field]: value };
      if (field === "ig_post")
        patch.ig_post_date = value ? new Date().toISOString() : null;
      if (field === "whatsapp")
        patch.whatsapp_post_date = value ? new Date().toISOString() : null;

      const { error } = await supabase
        .from("mockups")
        .update(patch)
        .eq("productid", productid);
      if (error) throw new Error(error.message);

      setRows((prev) =>
        prev.map((r) => (r.productid === productid ? { ...r, ...patch } : r))
      );
      toast({ title: "Saved" });
    } catch (err) {
      console.error(err);
      toast({
        variant: "destructive",
        title: "Save failed",
        description: err.message,
      });
    }
  };

  const filterInputClass =
    "h-7 text-xs border-gray-300 bg-muted text-gray-800 placeholder-gray-400 text-center";

  return (
    <div className="overflow-x-auto">
      <div className="flex justify-between items-center m-2">
        <Button
          variant="secondary"
          onClick={() =>
            setFilters({
              productid: "",
              category: "",
              fabric: "",
              size: "",
              color: "",
              redo: "All",
              base_mockup: "All",
              file_mockup: "All",
              mockup: "All",
              video: "All",
              ig_post: "All",
              ig_reel: "All",
              whatsapp: "All",
            })
          }
        >
          Clear Filters
        </Button>
      </div>
      <div className="overflow-y-auto max-h-[80vh]">
        <table className="product-table w-full border-collapse">
          <thead className="bg-gray-100">
            <tr>
              <th className="sticky top-0 z-30 bg-gray-100 w-32 text-center">
                Product ID
              </th>
              <th className="sticky top-0 z-30 bg-gray-100 w-32 text-center">
                Purchase Z Code
              </th>
              <th className="sticky top-0 z-30 bg-gray-100 w-32 text-center">
                Category
              </th>
              <th className="sticky top-0 z-30 bg-gray-100 w-32 text-center">
                Fabric
              </th>
              <th className="sticky top-0 z-30 bg-gray-100 w-40 text-center">
                Sizes
              </th>
              <th className="sticky top-0 z-30 bg-gray-100 w-40 text-center">
                Colors
              </th>
              <th className="sticky top-0 z-30 bg-gray-100 w-24 text-center">
                Redo
              </th>
              <th className="sticky top-0 z-30 bg-gray-100 w-24 text-center">
                Base Mockup
              </th>
              <th className="sticky top-0 z-30 bg-gray-100 w-24 text-center">
                File Mockup
              </th>
              <th className="sticky top-0 z-30 bg-gray-100 w-24 text-center">
                Mockup
              </th>
              <th className="sticky top-0 z-30 bg-gray-100 w-24 text-center">
                Video
              </th>
              <th className="sticky top-0 z-30 bg-gray-100 w-24 text-center">
                IG Post
              </th>
              <th className="sticky top-0 z-30 bg-gray-100 w-24 text-center">
                IG Reel
              </th>
              <th className="sticky top-0 z-30 bg-gray-100 w-24 text-center">
                WhatsApp
              </th>
              <th className="sticky top-0 z-30 bg-gray-100 w-36 text-center">
                Last IG Post
              </th>
              <th className="sticky top-0 z-30 bg-gray-100 w-40 text-center">
                Last WhatsApp Post
              </th>
            </tr>
            {stats && (
              <tr className="text-xs text-gray-600">
                <th className="sticky top-20 z-20 bg-gray-100"></th>
                <th className="sticky top-20 z-20 bg-gray-100"></th>
                <th className="sticky top-20 z-20 bg-gray-100"></th>
                <th className="sticky top-20 z-20 bg-gray-100"></th>
                <th className="sticky top-20 z-20 bg-gray-100"></th>
                <th className="sticky top-20 z-20 bg-gray-100"></th>
                <th className="sticky top-20 z-20 bg-gray-100 text-center">
                  {stats.redo_true}/{stats.total_count}
                </th>
                <th className="sticky top-20 z-20 bg-gray-100 text-center">
                  {stats.base_mockup_true}/{stats.total_count}
                </th>
                <th className="sticky top-20 z-20 bg-gray-100 text-center">
                  {stats.file_mockup_true}/{stats.total_count}
                </th>
                <th className="sticky top-20 z-20 bg-gray-100 text-center">
                  {stats.mockup_true}/{stats.total_count}
                </th>
                <th className="sticky top-20 z-20 bg-gray-100 text-center">
                  {stats.video_true}/{stats.total_count}
                </th>
                <th className="sticky top-20 z-20 bg-gray-100 text-center">
                  {stats.ig_post_true}/{stats.total_count}
                </th>
                <th className="sticky top-20 z-20 bg-gray-100 text-center">
                  {stats.ig_reel_true}/{stats.total_count}
                </th>
                <th className="sticky top-20 z-20 bg-gray-100 text-center">
                  {stats.whatsapp_true}/{stats.total_count}
                </th>
                <th className="sticky top-20 z-20 bg-gray-100"></th>
                <th className="sticky top-20 z-20 bg-gray-100"></th>
              </tr>
            )}
            {/* filter row */}
            <tr>
              <th className="sticky top-28 z-10 bg-gray-100">
                <Input
                  className={filterInputClass}
                  placeholder="Product ID"
                  value={filters.productid}
                  onChange={(e) =>
                    setFilters({ ...filters, productid: e.target.value })
                  }
                />
              </th>
              <th className="sticky top-28 z-10 bg-gray-100"></th>
              <th className="sticky top-28 z-10 bg-gray-100">
                <Input
                  className={filterInputClass}
                  placeholder="Category"
                  value={filters.category}
                  onChange={(e) =>
                    setFilters({ ...filters, category: e.target.value })
                  }
                />
              </th>
              <th className="sticky top-28 z-10 bg-gray-100">
                <Input
                  className={filterInputClass}
                  placeholder="Fabric"
                  value={filters.fabric}
                  onChange={(e) =>
                    setFilters({ ...filters, fabric: e.target.value })
                  }
                />
              </th>
              <th className="sticky top-28 z-10 bg-gray-100">
                <Input
                  className={filterInputClass}
                  placeholder="Size"
                  value={filters.size}
                  onChange={(e) =>
                    setFilters({ ...filters, size: e.target.value })
                  }
                />
              </th>
              <th className="sticky top-28 z-10 bg-gray-100">
                <Input
                  className={filterInputClass}
                  placeholder="Color"
                  value={filters.color}
                  onChange={(e) =>
                    setFilters({ ...filters, color: e.target.value })
                  }
                />
              </th>
              {[
                "redo",
                "base_mockup",
                "file_mockup",
                "mockup",
                "video",
                "ig_post",
                "ig_reel",
                "whatsapp",
              ].map((f) => (
                <th key={f} className="sticky top-28 z-10 bg-gray-100">
                  <select
                    className="sticky top-10 h-7 text-xs border-gray-300 bg-muted text-gray-800 text-center"
                    value={filters[f]}
                    onChange={(e) =>
                      setFilters({ ...filters, [f]: e.target.value })
                    }
                  >
                    <option value="">All</option>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                </th>
              ))}
              <th className="sticky top-28 z-10 bg-gray-100"></th>
              <th className="sticky top-28 z-10 bg-gray-100"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={16} className="text-center py-6">
                  <Loader2 className="h-5 w-5 mx-auto animate-spin text-muted-foreground" />
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <MockupRow
                  key={row.productid}
                  row={row}
                  onToggle={onToggle}
                  canEdit={canEdit}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* pagination */}
      <div className="flex justify-center items-center gap-2 py-4 flex-wrap text-sm text-gray-600">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCurrentPage(0)}
          disabled={currentPage === 0}
        >
          First
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCurrentPage((p) => Math.max(p - 1, 0))}
          disabled={currentPage === 0}
        >
          Previous
        </Button>
        <div className="flex items-center gap-2">
          <span>Page</span>
          <Input
            type="number"
            className="h-7 w-16 text-center text-sm"
            min={1}
            max={pageCount}
            value={inputPage}
            onChange={(e) => setInputPage(e.target.value)}
            onBlur={() => {
              const n = parseInt(inputPage, 10);
              if (!Number.isNaN(n) && n >= 1 && n <= pageCount) {
                setCurrentPage(n - 1);
              } else {
                setInputPage(String(currentPage + 1));
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const n = parseInt(inputPage, 10);
                if (!Number.isNaN(n) && n >= 1 && n <= pageCount) {
                  setCurrentPage(n - 1);
                } else {
                  setInputPage(String(currentPage + 1));
                }
              }
            }}
          />
          <span>of {pageCount}</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCurrentPage((p) => p + 1)}
          disabled={currentPage + 1 >= pageCount}
        >
          Next
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCurrentPage(pageCount - 1)}
          disabled={currentPage === pageCount - 1}
        >
          Last
        </Button>
      </div>
    </div>
  );
}
