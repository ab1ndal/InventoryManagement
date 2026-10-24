import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import Seo from "../components/Seo";
import { formatSize } from "../lib/sizes";
import { WHATSAPP_URL, formatRupees, refundChoose, refundPreview } from "../lib/ordersApi";

function WhatsAppLink() {
  return (
    <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="underline">
      WhatsApp us
    </a>
  );
}

const DEAD_ENDS = {
  invalid: {
    title: "This refund link isn't valid",
    body: "Please use the link from your latest email exactly as sent.",
  },
  expired: {
    title: "This refund link has expired",
    body: "Refunds not chosen within 48 hours go back to your original payment method automatically.",
  },
  already_chosen: {
    title: "You've already chosen your refund",
    body: "This refund is already on its way. Each refund link can be used once.",
  },
  error: {
    title: "We couldn't load your refund",
    body: "Please try again in a moment.",
  },
};

function deadEndFor(error) {
  if (error.status === 404 || error.code === "invalid_token") return "invalid";
  if (error.status === 410 || error.code === "expired") return "expired";
  if (error.code === "already_chosen") return "already_chosen";
  return "error";
}

function formatDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function ChosenResult({ result, preview }) {
  if (result.choice === "original") {
    return (
      <p>
        Your refund of ₹{formatRupees(preview.gatewayPart)} is on its way to your original payment method. It
        usually reaches you in 5–7 working days.
        {preview.creditPart > 0 && ` ₹${formatRupees(preview.creditPart)} you paid with store credit or a voucher comes back as credit.`}
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {result.creditAdded > 0 && (
        <p>₹{formatRupees(result.creditAdded)} has been added to your store credit. Use it at checkout when signed in.</p>
      )}
      {result.vouchers.map((v) => (
        <p key={v.code} className="border border-storefront-gold px-4 py-3">
          Your voucher code: <strong data-testid="voucher-code">{v.code}</strong> worth ₹{formatRupees(v.value)}
          {v.expiry && `, valid until ${formatDate(v.expiry)}`}. We've emailed it to you too.
        </p>
      ))}
    </div>
  );
}

export default function RefundChoicePage() {
  const { token } = useParams();
  // loading | choose | done | dead_end
  const [state, setState] = useState({ kind: "loading" });
  const [choosing, setChoosing] = useState(false);

  useEffect(() => {
    let active = true;
    refundPreview(token)
      .then((preview) => {
        if (!active) return;
        setState(
          preview.status === "awaiting_choice"
            ? { kind: "choose", preview }
            : { kind: "dead_end", reason: "already_chosen" }
        );
      })
      .catch((error) => {
        if (!active) return;
        console.warn("refund-choice preview failed", { code: error.code, status: error.status });
        setState({ kind: "dead_end", reason: deadEndFor(error) });
      });
    return () => {
      active = false;
    };
  }, [token]);

  async function choose(choice) {
    setChoosing(true);
    try {
      const result = await refundChoose(token, choice);
      setState((s) => ({ kind: "done", preview: s.preview, result }));
    } catch (error) {
      console.warn("refund-choice choose failed", { code: error.code, status: error.status });
      setState({ kind: "dead_end", reason: deadEndFor(error) });
    } finally {
      setChoosing(false);
    }
  }

  return (
    <div className="max-w-lg mx-auto px-4 sm:px-6 py-16 font-sans text-sm text-storefront-charcoal">
      <Seo title="Choose your refund" noindex />
      {state.kind === "loading" && <p className="text-storefront-muted">Loading your refund…</p>}

      {state.kind === "dead_end" && (
        <>
          <h1 className="font-display text-3xl font-semibold mb-3">{DEAD_ENDS[state.reason].title}</h1>
          <p>
            {DEAD_ENDS[state.reason].body} Questions? <WhatsAppLink />.
          </p>
        </>
      )}

      {state.kind === "choose" && (
        <div className="space-y-6">
          <div>
            <p className="text-xs tracking-widest uppercase text-storefront-muted mb-2">Order {state.preview.orderRef}</p>
            <h1 className="font-display text-3xl font-semibold">How would you like your ₹{formatRupees(state.preview.amount)} refund?</h1>
          </div>
          <ul className="divide-y divide-storefront-border border-y border-storefront-border">
            {state.preview.items.map((i, index) => (
              <li key={`${i.name}-${index}`} className="py-3">
                {i.name} ({formatSize(i.size)}/{i.color}) ×{i.units}
              </li>
            ))}
          </ul>
          {state.preview.creditPart > 0 && (
            <p className="text-storefront-muted">
              ₹{formatRupees(state.preview.creditPart)} you paid with store credit or a voucher always comes back as credit.
            </p>
          )}
          {state.preview.isGuest && (
            <p className="text-storefront-muted">Store credit for guest orders comes as a voucher code, by email.</p>
          )}
          <div className="flex flex-col gap-3">
            <button
              type="button"
              disabled={choosing}
              onClick={() => choose("store_credit")}
              className="w-full bg-storefront-charcoal text-storefront-cream text-xs tracking-widest uppercase py-4 disabled:opacity-40"
            >
              Instant store credit
            </button>
            <button
              type="button"
              disabled={choosing}
              onClick={() => choose("original")}
              className="w-full border border-storefront-charcoal text-xs tracking-widest uppercase py-4 disabled:opacity-40"
            >
              Refund to original payment method (5–7 working days)
            </button>
          </div>
          <p className="text-xs text-storefront-muted">
            Choose by {formatDate(state.preview.expiresAt)}. If you don't choose, the refund goes to your original payment method.
          </p>
        </div>
      )}

      {state.kind === "done" && (
        <div className="space-y-4">
          <h1 className="font-display text-3xl font-semibold">Refund confirmed</h1>
          <ChosenResult result={state.result} preview={state.preview} />
        </div>
      )}
    </div>
  );
}
