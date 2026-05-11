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

    const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
    const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
    const templateName = Deno.env.get("WHATSAPP_TEMPLATE_NAME");

    if (!phoneNumberId || !accessToken || !templateName) {
      return new Response(JSON.stringify({ error: "WhatsApp not configured" }), { status: 500, headers: CORS });
    }

    const normalized = phone.replace(/\D/g, "");

    const res = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: normalized,
        type: "template",
        template: {
          name: templateName,
          language: { code: "en" },
          components: [
            {
              type: "body",
              parameters: [
                { type: "text", text: customerName || "Customer" },
                { type: "text", text: String(billNumber) },
                { type: "text", text: String(amount) },
                { type: "text", text: pdfUrl || "" },
              ],
            },
          ],
        },
      }),
    });

    const result = await res.json();

    if (!res.ok || result.error) {
      return new Response(
        JSON.stringify({ error: result.error?.message || "WhatsApp delivery failed" }),
        { status: 502, headers: CORS },
      );
    }

    return new Response(
      JSON.stringify({ ok: true, channel: "whatsapp" }),
      { headers: { ...CORS, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
  }
});
