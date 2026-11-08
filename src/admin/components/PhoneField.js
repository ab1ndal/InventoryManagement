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

// Digits typed with the country code but no "+" (91 98100 00001) or with a
// leading 0 (098100 00001) would otherwise be stored as +9191... / +910...
// Once such a number is complete it is returned as "+<code><number>", so the
// code moves out of the number box. Returns null when the typed digits are
// already the number after the code (kept as typed, spaces and all), or are
// not yet a complete number.
const withoutRepeatedCode = (code, typed) => {
  const callingCode = code.replace(/^\+/, "");
  if (!callingCode) return null;
  const full = parsePhoneNumberFromString(typed, { defaultCallingCode: callingCode });
  if (!full?.isValid()) return null;
  return full.number === `${code}${typed}`.replace(/\s/g, "") ? null : full.number;
};

export default function PhoneField({
  value,
  onChange,
  onBlur,
  name,
  placeholder = "Phone (Optional)",
}) {
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
        placeholder={placeholder}
        value={number}
        onChange={(e) => {
          const typed = e.target.value;
          // A full number pasted with its own "+code" replaces both boxes.
          if (typed.startsWith("+")) {
            onChange(typed);
            return;
          }
          onChange(withoutRepeatedCode(code, typed) ?? compose(code, typed));
        }}
        onBlur={onBlur}
      />
    </div>
  );
}
