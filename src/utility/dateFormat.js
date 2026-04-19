import { format } from "date-fns";

export const formatDate = (dateStr) => {
    if (!dateStr) return "-";
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) return dateStr;
    const d = dateStr.includes("T") ? new Date(dateStr) : new Date(dateStr + "T00:00:00+05:30");
    return format(d, "dd/MM/yyyy");
};
