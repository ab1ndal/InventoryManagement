import * as React from "react";
import { useController } from "react-hook-form";
import { Input } from "./input";

// Currency input: shows a formatted "1,234.50" value, switches to raw editable
// digits while focused. Always shows the formatted value when disabled.
export function CurrencyInput({ control, name, disabled, className, ...rest }) {
  const { field } = useController({ control, name });
  const [focused, setFocused] = React.useState(false);
  const raw = field.value;
  const isEmpty = raw === "" || raw == null || isNaN(Number(raw));
  const num = Number(raw);
  const display =
    focused && !disabled
      ? raw ?? ""
      : isEmpty
      ? ""
      : `${num < 0 ? "-₹" : "₹"}${Math.abs(num).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return (
    <Input
      {...rest}
      type="text"
      inputMode="decimal"
      className={className}
      disabled={disabled}
      value={display}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        field.onBlur();
      }}
      onChange={(e) => field.onChange(e.target.value.replace(/[^0-9.-]/g, ""))}
    />
  );
}
