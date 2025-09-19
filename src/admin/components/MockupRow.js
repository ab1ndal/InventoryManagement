// src/admin/components/MockupRow.js
import React, { useMemo } from "react";
import { Checkbox } from "../../components/ui/checkbox";

const encodedPriceToCode = (price) => {
  const map = {
    1: "A",
    2: "B",
    3: "C",
    4: "D",
    5: "E",
    6: "F",
    7: "G",
    8: "H",
    9: "I",
    0: "Z",
  };
  const digits = Number(price || 0)
    .toString()
    .split("");
  return "Z" + digits.map((d) => map[d] ?? "Z").join("");
};

function formatDate(dt) {
  if (!dt) return "";
  try {
    const d = new Date(dt);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
    });
  } catch {
    return "";
  }
}

export default function MockupRow({ row, onToggle, canEdit }) {
  const {
    productid,
    fabric,
    category,
    purchaseprice,
    sizes,
    colors,
    redo,
    base_mockup,
    file_mockup,
    mockup,
    video,
    ig_post,
    ig_reel,
    whatsapp,
    ig_post_date,
    whatsapp_post_date,
  } = row;

  const zCode = useMemo(
    () => encodedPriceToCode(purchaseprice),
    [purchaseprice]
  );

  const ToggleCell = ({ field, checked }) => (
    <td className="text-center">
      <Checkbox
        checked={!!checked}
        onCheckedChange={(v) => onToggle(productid, field, !!v)}
        disabled={!canEdit}
      />
    </td>
  );

  let bgColor = "bg-white";
  if (redo) bgColor = "bg-red-100";
  else if (mockup) bgColor = "bg-green-100";
  else if (file_mockup) bgColor = "bg-green-50";
  else if (base_mockup) bgColor = "bg-yellow-100";

  return (
    <tr className={bgColor}>
      <td className="text-center">{productid}</td>
      <td className="text-center">{zCode}</td>
      <td className="text-center">{category || ""}</td>
      <td className="text-center">{fabric || ""}</td>
      <td>{sizes}</td>
      <td>{colors}</td>

      <ToggleCell field="redo" checked={redo} />
      <ToggleCell field="base_mockup" checked={base_mockup} />
      <ToggleCell field="file_mockup" checked={file_mockup} />
      <ToggleCell field="mockup" checked={mockup} />
      <ToggleCell field="video" checked={video} />
      <ToggleCell field="ig_post" checked={ig_post} />
      <ToggleCell field="ig_reel" checked={ig_reel} />
      <ToggleCell field="whatsapp" checked={whatsapp} />

      <td className="text-center whitespace-nowrap">
        {formatDate(ig_post_date)}
      </td>
      <td className="text-center whitespace-nowrap">
        {formatDate(whatsapp_post_date)}
      </td>
    </tr>
  );
}
