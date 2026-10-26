// Made-to-order tailoring (owner 2026-10-25). Phase A of
// tasks/customization-plan.md: requests come in on WhatsApp (or email), the
// shop quotes there, and the advance and balance are paid by Cashfree
// Payment Links made in the dashboard. Terms here must match the "Custom
// orders" sections in policies/policyContent.js.
//
// Kept short on purpose (owner: the first version was too much to read):
// the page shows steps and quick facts; the full rules sit in a fold.

const SHOP_WHATSAPP = "919810873280";
const SHOP_EMAIL = "bindalscreations@gmail.com";

const REQUEST_TEMPLATE = [
  "Hi Bindal's Creation, I saw a design I love and would like it made.",
  "Garment: ",
  "Budget: ",
  "Quantity: ",
  "Size: ",
  "Fabric (optional): ",
  "Needed by (optional): ",
  "I'm attaching the photo.",
].join("\n");

export const WHATSAPP_REQUEST_URL = `https://wa.me/${SHOP_WHATSAPP}?text=${encodeURIComponent(REQUEST_TEMPLATE)}`;
export const EMAIL_REQUEST_URL = `mailto:${SHOP_EMAIL}?subject=${encodeURIComponent(
  "Custom order request"
)}&body=${encodeURIComponent(REQUEST_TEMPLATE)}`;

export const CUSTOMIZE = {
  title: "Seen a look you love?",
  lede: "A film star's lehenga, a look from Instagram, a photo from a friend's wedding. Send it to us and our in-house tailors will make it for you, in your size.",
  pitch: "Most shops sell you something like it. We make the one in your photo, as close as we possibly can.",
  makes: [
    "Lehengas",
    "Sarees & blouses",
    "Dresses & gowns",
    "Kurtis",
    "Suits",
    "Sherwanis",
    "Jodhpuri suits",
    "Formal suits",
    "Blazers",
    "Coat-pants",
  ],
  steps: [
    { title: "Send the photo", desc: "A screenshot or photo, your budget and size, on WhatsApp." },
    { title: "Get a quote", desc: "We reply with a price and a ready-by date." },
    { title: "Pay 50% to start", desc: "We measure you at the shop or on a video call." },
    { title: "Collect or get it delivered", desc: "Pay the rest when it's ready." },
  ],
  facts: [
    { value: "2–4 weeks", label: "Rush orders possible" },
    { value: "From ₹3,000", label: "Minimum order" },
    { value: "50%", label: "Advance to start" },
    { value: "Free", label: "Alterations at the shop" },
  ],
  goodToKnow: [
    "We match your photo as closely as we can. Fabric, handwork and colour can differ a little from the picture, and we'll tell you about any change when we quote.",
    "Rush orders (under 2 weeks) cost extra. The quote shows how much.",
    "Your budget helps us plan. The price in our quote is the final price.",
    "Have your own fabric? We'll quote for stitching only.",
    "Delivery is within Uttar Pradesh, for a fee shown in the quote. Or collect from the shop.",
    "Fittings and free alterations are done at the shop. We can't take back delivered pieces for alterations, but you're always welcome to bring them in.",
    "We start work as soon as the advance is paid. If you change your mind, call or WhatsApp us within 1 day and we'll tell you if a refund is still possible. After that the advance can't be refunded. If we ever have to cancel, we refund everything you paid.",
  ],
};
