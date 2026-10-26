// Made-to-order tailoring (owner 2026-10-25). Phase A of
// tasks/customization-plan.md: requests come in on WhatsApp (or email), the
// shop quotes there, and the advance and balance are paid by Cashfree
// Payment Links made in the dashboard. Terms here must match the "Custom
// orders" sections in policies/policyContent.js.

const SHOP_WHATSAPP = "919810873280";
const SHOP_EMAIL = "bindalscreations@gmail.com";

const REQUEST_TEMPLATE = [
  "Hi Bindal's Creation, I'd like a custom piece made.",
  "Garment: ",
  "Budget: ",
  "Quantity: ",
  "Size: ",
  "Fabric (optional): ",
  "Needed by (optional): ",
  "I'm attaching a photo of the design.",
].join("\n");

export const WHATSAPP_REQUEST_URL = `https://wa.me/${SHOP_WHATSAPP}?text=${encodeURIComponent(REQUEST_TEMPLATE)}`;
export const EMAIL_REQUEST_URL = `mailto:${SHOP_EMAIL}?subject=${encodeURIComponent(
  "Custom order request"
)}&body=${encodeURIComponent(REQUEST_TEMPLATE)}`;

export const CUSTOMIZE = {
  title: "Made for You",
  lede: "Send us a photo of the design you love, and our in-house designers and tailors will make it for you. Lehengas, sarees, suits, sherwanis, blazers and more, stitched to your size.",
  makes: [
    {
      group: "For women",
      items: ["Lehengas", "Sarees and blouses", "Dresses and gowns", "Kurtis", "Suits"],
    },
    {
      group: "For men",
      items: ["Sherwanis", "Jodhpuri suits", "Suits and formal suits", "Blazers", "Coat-pants"],
    },
  ],
  steps: [
    {
      title: "Send us your design",
      desc: "Message us on WhatsApp with a photo of the design, what you'd like made, your budget, quantity and your usual size. Email works too.",
    },
    {
      title: "Get a quote",
      desc: "We'll reply with a price and a ready-by date. The quote depends on the design, how busy our tailors are and how soon you need it.",
    },
    {
      title: "Pay 50% to start",
      desc: "Once you accept, pay half by UPI, card or net banking. We take your measurements at the shop, or guide you over a video call.",
    },
    {
      title: "Fitting and the rest",
      desc: "Collect from the shop with one fitting and free alterations, or get it delivered within Uttar Pradesh for a fee. Pay the balance when it's ready.",
    },
  ],
  goodToKnow: [
    "Most pieces take 2 to 4 weeks. Need it sooner? Rush orders (under 2 weeks) are possible for an extra charge.",
    "Minimum order is ₹3,000.",
    "Your budget helps us plan. The price in our quote is the final price.",
    "Have your own fabric? Bring it in and we'll quote for stitching only.",
    "Fittings and free alterations are done at the shop. We can't take back delivered pieces for alterations, but you're always welcome to bring them in.",
    "We start work as soon as the advance is paid. If you change your mind, call or WhatsApp us within 1 day and we'll tell you if a refund is still possible. After that the advance can't be refunded. If we ever have to cancel, we refund everything you paid.",
  ],
};
