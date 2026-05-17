import { useState, useEffect, useCallback } from "react";

export function useTableFilters(initialFilters, debounceMs = 300) {
  const [filters, setFilters] = useState(initialFilters);
  const [debouncedFilters, setDebouncedFilters] = useState(initialFilters);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedFilters(filters), debounceMs);
    return () => clearTimeout(timer);
  }, [filters, debounceMs]);

  const setFilter = useCallback((key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const resetFilters = useCallback(() => {
    setFilters(initialFilters);
  }, [initialFilters]);

  return { filters, setFilter, setFilters, debouncedFilters, resetFilters };
}
