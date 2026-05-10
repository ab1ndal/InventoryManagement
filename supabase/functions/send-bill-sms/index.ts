import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { phone, customerName, billNumber, amount, pdfUrl } = await req.json();

    if (!phone) return new Response(JSON.stringify({ error: "phone required" }), { status: 400, headers: CORS });

    const apiKey = Deno.env.get("MSG91_API_KEY");
    const templateId = Deno.env.get("MSG91_TEMPLATE_ID");
    const senderId = Deno.env.get("MSG91_SENDER_ID") ?? "BNDLCR";

    if (!apiKey || !templateId) {
      return new Response(JSON.stringify({ error: "MSG91 not configured" }), { status: 500, headers: CORS });
    }

    // Normalize phone: strip non-digits, ensure 91XXXXXXXXXX
    const digits = phone.replace(/\D/g, "");
    const normalized = digits.startsWith("91") ? digits : `91${digits}`;

    // MSG91 Flow API — variables must match DLT template order:
    // Dear {#var#}, your bill no. {#var#} of Rs {#var#} is ready. View invoice: {#var#} -BNDLCR
    const payload = {
      template_id: templateId,
      sender: senderId,
      short_url: "0",
      mobiles: normalized,
      VAR1: customerName || "Customer",
      VAR2: String(billNumber),
      VAR3: String(amount),
      VAR4: pdfUrl || "",
    };

    const res = await fetch("https://api.msg91.com/api/v5/flow/", {
      method: "POST",
      headers: {
        authkey: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const result = await res.json();

    if (!res.ok || result.type === "error") {
      return new Response(JSON.stringify({ error: result.message || "MSG91 error" }), {
        status: 502,
        headers: CORS,
      });
    }

    return new Response(JSON.stringify({ ok: true, requestId: result.request_id }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
  }
});
