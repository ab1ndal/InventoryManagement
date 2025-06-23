import React, { useState, useRef, useEffect } from "react";

export default function CustomDropdown({
  label,
  value,
  onChange,
  onBlur,
  options = [],
  placeholder = "Select an option",
  className = "",
}) {
  const [open, setOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const containerRef = useRef(null);

  const handleSelect = (selectedValue) => {
    onChange(selectedValue);
    setOpen(false);
    setSearchTerm(""); // clear search after selection
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target)
      ) {
        setOpen(false);
        setSearchTerm("");
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

  return (
    <div className={`w-full ${className}`} ref={containerRef}>
      {label && (
        <label className="block mb-1 text-sm font-medium">{label}</label>
      )}

      <div className="relative">
        <button
          type="button"
          className="w-full border rounded px-2 py-2 bg-white text-sm text-left"
          onClick={() => setOpen((prev) => !prev)}
        >
          {selectedLabel || (
            <span className="text-gray-400">{placeholder}</span>
          )}
        </button>

        {open && (
          <div className="absolute z-10 w-full mt-1 border bg-white shadow rounded">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              autoFocus
              className="w-full px-3 py-2 text-sm border-b focus:outline-none"
              placeholder="Search..."
            />
            <ul className="max-h-48 overflow-y-auto text-sm">
              {filteredOptions.length > 0 ? (
                filteredOptions.map((opt) => (
                  <li
                    key={opt.value}
                    className="px-3 py-2 hover:bg-gray-100 cursor-pointer"
                    onClick={() => handleSelect(opt.value)}
                  >
                    {opt.label}
                  </li>
                ))
              ) : (
                <li className="px-3 py-2 text-gray-400">No options found</li>
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
