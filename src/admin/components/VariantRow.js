const formatStock = (value) => {
  if (isNaN(value)) return "0 pcs";
  return `${Number(value).toLocaleString("en-IN")} pcs`;
};

const VariantRow = ({ row, colSpan }) => {
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
            <strong>Stock:</strong> {formatStock(row.stock)}
          </div>
        </div>
      </td>
    </tr>
  );
};

export default VariantRow;
