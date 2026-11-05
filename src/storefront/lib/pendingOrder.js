// Remembers which order this tab just checked out, so the order page empties
// the cart only for that order once it is paid (not when an old order link
// from an email is opened later). Per-tab convenience: storage can be blocked,
// in which case the cart is simply left as it is.
const KEY = "bc_pending_order";
// Unlike KEY these are not one-shot: they last for the tab, so a reload or Back
// to the order page still knows this tab placed the order and has its token.
const CHECKED_OUT_PREFIX = "bc_checked_out_";
const TOKEN_PREFIX = "bc_order_token_";

export function rememberPendingOrder(orderRef) {
  try {
    window.sessionStorage.setItem(KEY, orderRef);
    window.sessionStorage.setItem(CHECKED_OUT_PREFIX + orderRef, "1");
  } catch (error) {
    console.warn("sessionStorage unavailable; cart will not auto-clear", error);
  }
}

// True when this tab placed `orderRef` (not consumed by takePendingOrder).
export function wasCheckedOutInThisTab(orderRef) {
  try {
    return window.sessionStorage.getItem(CHECKED_OUT_PREFIX + orderRef) === "1";
  } catch {
    return false;
  }
}

// Keeps the order's access token for this tab so it can leave the address bar.
// Returns false when it could not be kept, in which case the caller must leave
// the token where it is.
export function storeOrderToken(orderRef, token) {
  try {
    window.sessionStorage.setItem(TOKEN_PREFIX + orderRef, token);
    return window.sessionStorage.getItem(TOKEN_PREFIX + orderRef) === token;
  } catch {
    return false;
  }
}

export function readOrderToken(orderRef) {
  try {
    return window.sessionStorage.getItem(TOKEN_PREFIX + orderRef) || "";
  } catch {
    return "";
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
