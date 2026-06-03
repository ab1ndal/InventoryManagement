import { format } from "date-fns";

export const formatDate = (dateStr) => {
    if (!dateStr) return "-";
    if (dateStr instanceof Date) return format(dateStr, "dd/MM/yyyy");
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) return dateStr;
    const d = dateStr.includes("T") ? new Date(dateStr) : new Date(dateStr + "T00:00:00+05:30");
    return format(d, "dd/MM/yyyy");
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
