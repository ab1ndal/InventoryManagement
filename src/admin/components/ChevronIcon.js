import React from "react";

const ChevronIcon = ({ expanded }) => {
  return (
    <svg
      className={`chevron-icon ${expanded ? "expanded" : ""}`}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      style={{ marginRight: "8px", verticalAlign: "middle" }}
    >
      <polyline
        points="6 9 12 15 18 9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

export default ChevronIcon;
