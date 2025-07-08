import React from "react";
import { Pencil, Printer, Trash2 } from "lucide-react";
import { Button } from "../components/ui/button";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "../components/ui/tooltip";

// Utility to prevent row toggle
const safeClick = (e, handler) => {
  e.stopPropagation();
  handler?.();
};

// Edit Button
export const EditButton = ({ onClick }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button
        variant="ghost"
        size="icon"
        className="text-yellow-600 hover:bg-yellow-100"
        onClick={(e) => safeClick(e, onClick)}
      >
        <Pencil className="h-4 w-4" />
      </Button>
    </TooltipTrigger>
    <TooltipContent>Edit</TooltipContent>
  </Tooltip>
);

// Print Button
export const PrintButton = ({ onClick }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button
        variant="ghost"
        size="icon"
        className="text-blue-600 hover:bg-blue-100"
        onClick={(e) => safeClick(e, onClick)}
      >
        <Printer className="h-4 w-4" />
      </Button>
    </TooltipTrigger>
    <TooltipContent>Print</TooltipContent>
  </Tooltip>
);

// Delete Button
export const DeleteButton = ({ onClick }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button
        variant="ghost"
        size="icon"
        className="text-red-600 hover:bg-red-100"
        onClick={(e) => safeClick(e, onClick)}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </TooltipTrigger>
    <TooltipContent>Delete</TooltipContent>
  </Tooltip>
);
