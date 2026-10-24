// Remembers which order this tab just checked out, so the order page empties
// the cart only for that order once it is paid (not when an old order link
// from an email is opened later). Per-tab convenience: storage can be blocked,
// in which case the cart is simply left as it is.
const KEY = "bc_pending_order";

export function rememberPendingOrder(orderRef) {
  try {
    window.sessionStorage.setItem(KEY, orderRef);
  } catch (error) {
    console.warn("sessionStorage unavailable; cart will not auto-clear", error);
  }
}

// True (once) when `orderRef` is the order this tab checked out.
export function takePendingOrder(orderRef) {
  try {
    if (window.sessionStorage.getItem(KEY) !== orderRef) return false;
    window.sessionStorage.removeItem(KEY);
    return true;
  } catch (error) {
    console.warn("sessionStorage unavailable; cart will not auto-clear", error);
    return false;
  }
}
