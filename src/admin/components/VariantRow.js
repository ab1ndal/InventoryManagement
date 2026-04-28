const formatStock = (value, unitType = "piece") => {
  if (isNaN(value)) return unitType === "meter" ? "0 m" : "0 pcs";
  const num = Number(value);
  const formatted =
    unitType === "meter"
      ? num.toLocaleString("en-IN", { maximumFractionDigits: 3 })
      : num.toLocaleString("en-IN", { maximumFractionDigits: 0 });
  return `${formatted} ${unitType === "meter" ? "m" : "pcs"}`;
};

const VariantRow = ({ row, colSpan, unitType = "piece" }) => {
  return (
    <tr className="variant-row">
      <td colSpan={colSpan}>
        <div className="variant-line">
          <div className="variant-part">
            <strong>Size:</strong> {row.size}
          </div>
          <div className="variant-separator">|</div>
          <div className="variant-part">
            <strong>Color:</strong> {row.color}
          </div>
          <div className="variant-separator">|</div>
          <div className="variant-part">
            <strong>Stock:</strong> {formatStock(row.stock, unitType)}
          </div>
        </div>
      </td>
    </tr>
  );
};

export default VariantRow;
