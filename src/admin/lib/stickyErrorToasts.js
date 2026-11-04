import { toast } from "sonner";

// Sonner has no per-type duration, so error toasts are made to stay until
// dismissed by wrapping toast.error. A duration passed at a call site still wins.
// Returns a function that puts the original back.
export function keepErrorToastsUntilDismissed() {
  const original = toast.error;
  toast.error = (message, options) =>
    original(message, { duration: Infinity, ...options });
  return () => {
    toast.error = original;
  };
}
