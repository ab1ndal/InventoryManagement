import { parsePhoneNumberFromString } from "libphonenumber-js";

export function formatPhone(value) {
  if (!value) return "-";
  try {
    const phone = parsePhoneNumberFromString(value);
    return phone ? phone.formatInternational() : value;
  } catch {
    return value;
  }
}
