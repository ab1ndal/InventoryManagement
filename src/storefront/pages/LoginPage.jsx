import React, { useState } from "react";
import Seo from "../components/Seo";
import { useStorefrontAuth } from "../context/StorefrontAuthContext";

export default function LoginPage() {
  const { signInWithOtp } = useStorefrontAuth();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = (await signInWithOtp(email)) || {};
    setBusy(false);
    if (error) setError(error.message || "Could not send the link. Try again.");
    else setSent(true);
  }

  return (
    <div className="max-w-md mx-auto px-4 sm:px-6 py-16">
      <Seo title="Sign in" noindex />
      <h1 className="font-display text-3xl font-semibold text-storefront-charcoal mb-2">Sign in</h1>
      <p className="text-sm text-storefront-muted font-sans mb-8">
        We'll email you a secure link — no password needed.
      </p>

      {sent ? (
        <p className="text-sm font-sans text-storefront-charcoal">
          Check your inbox — we sent a sign-in link to <strong>{email}</strong>.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <label className="block text-xs font-sans tracking-wide text-storefront-charcoal" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border border-storefront-border bg-white px-3 py-3 text-sm font-sans focus:outline-none focus:border-storefront-gold"
          />
          {error && <p className="text-xs text-red-600 font-sans">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full bg-storefront-charcoal text-storefront-cream font-sans text-xs tracking-widest uppercase py-4 hover:bg-storefront-warm transition-colors disabled:opacity-40"
          >
            {busy ? "Sending…" : "Email me a sign-in link"}
          </button>
        </form>
      )}
    </div>
  );
}
