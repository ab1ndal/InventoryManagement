// src/admin/components/billing/SalespersonSelector.js
import { useState, useEffect, useRef } from "react";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Checkbox } from "../../../components/ui/checkbox";
import { supabase } from "../../../lib/supabaseClient";
import { useToast } from "../../../components/hooks/use-toast";

export default function SalespersonSelector({ selectedIds, setSelectedIds }) {
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [salespersons, setSalespersons] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef(null);

  useEffect(() => {
    const loadSalespersons = async () => {
      const { data, error } = await supabase
        .from("salespersons")
        .select("salesperson_id, name")
        .eq("active", true)
        .order("name");

      if (error) {
        toast({
          title: "Error",
          description: "Could not load salespersons. Refresh and try again.",
          variant: "destructive",
        });
      } else {
        setSalespersons(data || []);
      }
      setLoading(false);
    };

    loadSalespersons();
  }, [toast]);

  useEffect(() => {
    const handleMouseDown = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    };

    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        setShowDropdown(false);
      }
    };

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const filtered = salespersons.filter((s) =>
    s.name.toLowerCase().includes(query.toLowerCase())
  );

  const toggleSalesperson = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  return (
    <div className="grid gap-1" ref={containerRef}>
      <Label>Salesperson(s)</Label>
      <div className="relative">
        <Input
          placeholder="Search salesperson"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowDropdown(true);
          }}
          onFocus={() => setShowDropdown(true)}
          disabled={loading}
        />
        {showDropdown && (
          <div className="absolute z-10 w-full mt-1 bg-white border rounded shadow max-h-48 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">
                No active salespersons found
              </div>
            ) : (
              filtered.map((s) => (
                <div
                  key={s.salesperson_id}
                  className="flex items-center gap-2 px-3 py-2 hover:bg-gray-100 cursor-pointer"
                  onClick={() => toggleSalesperson(s.salesperson_id)}
                >
                  <Checkbox
                    checked={selectedIds.includes(s.salesperson_id)}
                    onCheckedChange={() => toggleSalesperson(s.salesperson_id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <span className="text-sm">{s.name}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
      {/* Selected chips */}
      {selectedIds.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {selectedIds.map((id) => {
            const sp = salespersons.find((s) => s.salesperson_id === id);
            return sp ? (
              <span
                key={id}
                className="inline-flex items-center gap-1 bg-secondary text-secondary-foreground rounded-full px-2 py-0.5 text-xs"
              >
                {sp.name}
                <button
                  type="button"
                  className="ml-1 opacity-60 hover:opacity-100"
                  onClick={() => toggleSalesperson(id)}
                >
                  x
                </button>
              </span>
            ) : null;
          })}
        </div>
      )}
    </div>
  );
}
