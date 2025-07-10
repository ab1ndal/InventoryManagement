import { format } from "date-fns";

export const formatDate = (dateStr) => {
    if (!dateStr) return "-";
  return format(new Date(dateStr + "T00:00:00+05:30"), "dd/MM/yyyy");
};
