import { format } from "date-fns";

export const formatDate = (dateStr) => {
    if (!dateStr) return "-";
    if (dateStr instanceof Date) return format(dateStr, "dd/MM/yyyy");
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) return dateStr;
    // Plain date (no time component) — format the y/m/d parts directly so the
    // result can never shift by a day depending on the browser's timezone.
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        const [y, m, d] = dateStr.split("-");
        return `${d}/${m}/${y}`;
    }
    return format(new Date(dateStr), "dd/MM/yyyy");
};

// Always render activity-log timestamps in Indian Standard Time.
export const formatDateTimeIST = (value) => {
  if (!value) return "-";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(d)
    .replace(",", "");
};
