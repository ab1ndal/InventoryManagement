import { formatStock } from "../../utility/formatStock";

const VariantRow = ({ row, colSpan, unitType = "piece" }) => {
  const isDepleted = (row.stock || 0) === 0;
  return (
    <tr className={`variant-row${isDepleted ? " depleted" : ""}`}>
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
