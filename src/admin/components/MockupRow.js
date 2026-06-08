// src/admin/components/MockupRow.js
import React, { useMemo } from "react";
import { formatDate as formatDateUtil } from "../../utility/dateFormat";
import { Checkbox } from "../../components/ui/checkbox";
import { encodePriceToZCode } from "../../utility/zCode";

const formatDate = (dt) => formatDateUtil(dt) || "";

export default function MockupRow({ row, onToggle, canEdit }) {
  const {
    productid,
    fabric,
    category,
    purchaseprice,
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
    () => encodePriceToZCode(purchaseprice),
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
