import React, { useState, useRef, useEffect } from "react";
import { Check, ChevronsUpDown, Search, Plus } from "lucide-react";

export default function CustomDropdown({
  label,
  value,
  onChange,
  onBlur,
  options = [],
  placeholder = "Select an option",
  className = "",
  onAddNew, // optional: (searchTerm) => void — shows an explicit "+ Add …" action when the typed value matches no option
}) {
  const [open, setOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef(null);

  const close = () => {
    setOpen(false);
    setSearchTerm("");
  };

  const handleSelect = (selectedValue) => {
    onChange(selectedValue);
    close();
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target)
      ) {
        close();
        if (onBlur) onBlur();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onBlur]);

  const selectedLabel = options.find((opt) => opt.value === value)?.label;

  const filteredOptions = options.filter((opt) =>
    opt.label.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const trimmedSearch = searchTerm.trim();
  const showAddNew =
    onAddNew &&
    trimmedSearch &&
    !options.some(
      (opt) =>
        opt.label.toLowerCase() === trimmedSearch.toLowerCase() ||
        String(opt.value).toLowerCase() === trimmedSearch.toLowerCase()
    );

  // Flat list of keyboard-navigable rows: every filtered option, then the
  // optional "+ Add …" action as the final row.
  const rowCount = filteredOptions.length + (showAddNew ? 1 : 0);

  // Keep the highlight in range as the filter narrows the list.
  useEffect(() => {
    setHighlight(0);
  }, [searchTerm, open]);

  const commitHighlight = () => {
    if (highlight < filteredOptions.length) {
      handleSelect(filteredOptions[highlight].value);
    } else if (showAddNew) {
      close();
      onAddNew(trimmedSearch);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((i) => (rowCount ? (i + 1) % rowCount : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((i) => (rowCount ? (i - 1 + rowCount) % rowCount : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      commitHighlight();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  const addNewIndex = filteredOptions.length;

  return (
    <div className={`w-full ${className}`} ref={containerRef}>
      {label && (
        <label className="block mb-1 text-sm font-medium">{label}</label>
      )}

      <div className="relative">
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          className="flex w-full items-center justify-between gap-2 rounded-md border border-input bg-white px-3 py-2 text-sm text-left shadow-xs transition-colors hover:border-ring/60 focus:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
          onClick={() => setOpen((prev) => !prev)}
        >
          <span className={selectedLabel ? "truncate" : "truncate text-muted-foreground"}>
            {selectedLabel || placeholder}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </button>

        {open && (
          <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-input bg-white shadow-lg ring-1 ring-black/5">
            <div className="relative border-b">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={handleKeyDown}
                autoFocus
                className="w-full bg-transparent py-2.5 pl-8 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none"
                placeholder="Search…"
              />
            </div>
            <ul role="listbox" className="max-h-56 overflow-y-auto p-1 text-sm">
              {filteredOptions.length > 0 ? (
                filteredOptions.map((opt, i) => {
                  const isSelected = opt.value === value;
                  const isActive = i === highlight;
                  return (
                    <li
                      key={opt.value}
                      role="option"
                      aria-selected={isSelected}
                      onMouseEnter={() => setHighlight(i)}
                      onClick={() => handleSelect(opt.value)}
                      className={`flex cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-1.5 ${
                        isActive ? "bg-accent text-accent-foreground" : ""
                      } ${isSelected ? "font-medium" : ""}`}
                    >
                      <span className="truncate">{opt.label}</span>
                      {isSelected && <Check className="size-4 shrink-0 text-primary" />}
                    </li>
                  );
                })
              ) : (
                !showAddNew && (
                  <li className="px-2 py-1.5 text-muted-foreground">
                    No options found
                  </li>
                )
              )}
              {showAddNew && (
                <li
                  role="option"
                  aria-selected={false}
                  onMouseEnter={() => setHighlight(addNewIndex)}
                  onClick={() => {
                    close();
                    onAddNew(trimmedSearch);
                  }}
                  className={`mt-1 flex cursor-pointer items-center gap-2 rounded-sm border-t px-2 py-1.5 text-primary ${
                    highlight === addNewIndex ? "bg-accent" : ""
                  }`}
                >
                  <Plus className="size-4 shrink-0" />
                  <span className="truncate">Add “{trimmedSearch}”…</span>
                </li>
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
