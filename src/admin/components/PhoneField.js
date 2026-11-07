// src/admin/components/PhoneField.js
// Phone entry as two boxes: country code (default +91) and the number.
// The form keeps one string, "+<code><number>", or "" when no number is typed.
// Nothing is reformatted while typing, so the cursor stays where it is.
import React from "react";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { Input } from "../../components/ui/input";

export const DEFAULT_COUNTRY_CODE = "+91";

// Country code of a full "+..." number, or null if it can't be read yet.
const codeOf = (value) => {
  const parsed = parsePhoneNumberFromString(String(value).replace(/\s/g, ""));
  return parsed ? `+${parsed.countryCallingCode}` : null;
};

export default function PhoneField({ value, onChange, onBlur, name }) {
  const text = value ?? "";
  const [code, setCode] = React.useState(
    () => (text.startsWith("+") && codeOf(text)) || DEFAULT_COUNTRY_CODE,
  );

  // A value set from outside (form reset, pasted full number) with another
  // country code moves that code into the code box.
  React.useEffect(() => {
    if (text.startsWith("+") && !text.startsWith(code)) {
      const found = codeOf(text);
      if (found) setCode(found);
    }
  }, [text, code]);

  const number = text.startsWith(code) ? text.slice(code.length) : text;

  const compose = (c, n) => (n.trim() ? `${c}${n}` : "");

  return (
    <div className="flex gap-2">
      <Input
        aria-label="Country code"
        className="w-20"
        inputMode="tel"
        value={code}
        onChange={(e) => {
          setCode(e.target.value);
          onChange(compose(e.target.value, number));
        }}
        onBlur={onBlur}
      />
      <Input
        name={name}
        className="flex-1"
        inputMode="tel"
        placeholder="Phone (Optional)"
        value={number}
        onChange={(e) => {
          const typed = e.target.value;
          // A full number pasted with its own "+code" replaces both boxes.
          onChange(typed.startsWith("+") ? typed : compose(code, typed));
        }}
        onBlur={onBlur}
      />
    </div>
  );
}
