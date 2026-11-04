import { toast } from "sonner";
import { keepErrorToastsUntilDismissed } from "../stickyErrorToasts";

test("error toasts get no timeout, other toasts are untouched, restore works", () => {
  const original = toast.error;
  const spy = jest.fn();
  toast.error = spy;
  const restore = keepErrorToastsUntilDismissed();

  toast.error("Boom", { description: "x" });
  expect(spy).toHaveBeenCalledWith("Boom", { duration: Infinity, description: "x" });

  toast.error("Own timing", { duration: 1000 });
  expect(spy).toHaveBeenLastCalledWith("Own timing", { duration: 1000 });

  restore();
  expect(toast.error).toBe(spy);
  toast.error = original;
});
