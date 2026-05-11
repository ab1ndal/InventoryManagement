import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function sendWhatsApp(
  apiKey: string,
  integratedNumber: string,
  templateName: string,
  to: string,
  customerName: string,
  billNumber: string,
  amount: string,
  pdfUrl: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/", {
      method: "POST",
      headers: {
        authkey: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        integrated_number: integratedNumber,
        content_type: "template",
        payload: {
          to,
          type: "template",
          template: {
            name: templateName,
            language: { code: "en" },
            components: [
              {
                type: "body",
                parameters: [
                  { type: "text", text: customerName },
                  { type: "text", text: billNumber },
                  { type: "text", text: amount },
                  { type: "text", text: pdfUrl },
                ],
              },
            ],
          },
        },
      }),
    });
    const result = await res.json();
    if (!res.ok || result.type === "error") {
      return { ok: false, error: result.message || "WhatsApp error" };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function sendSms(
  apiKey: string,
  templateId: string,
  senderId: string,
  to: string,
  customerName: string,
  billNumber: string,
  amount: string,
  pdfUrl: string,
): Promise<{ ok: boolean; requestId?: string; error?: string }> {
  try {
    const res = await fetch("https://api.msg91.com/api/v5/flow/", {
      method: "POST",
      headers: {
        authkey: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        template_id: templateId,
        sender: senderId,
        short_url: "1",
        mobiles: to,
        VAR1: customerName,
        VAR2: billNumber,
        VAR3: amount,
        VAR4: pdfUrl,
      }),
    });
    const result = await res.json();
    if (!res.ok || result.type === "error") {
      return { ok: false, error: result.message || "SMS error" };
    }
    return { ok: true, requestId: result.request_id };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { phone, customerName, billNumber, amount, pdfUrl } = await req.json();

    if (!phone) return new Response(JSON.stringify({ error: "phone required" }), { status: 400, headers: CORS });

    const apiKey = Deno.env.get("MSG91_API_KEY");
    const templateId = Deno.env.get("MSG91_TEMPLATE_ID");
    const senderId = Deno.env.get("MSG91_SENDER_ID") ?? "BNDLCR";
    const waNumber = Deno.env.get("MSG91_WHATSAPP_NUMBER");
    const waTemplate = Deno.env.get("MSG91_WHATSAPP_TEMPLATE");

    if (!apiKey || !templateId) {
      return new Response(JSON.stringify({ error: "MSG91 not configured" }), { status: 500, headers: CORS });
    }

    // Normalize phone: strip non-digits, trust country code from caller
    const normalized = phone.replace(/\D/g, "");
    const name = customerName || "Customer";
    const bill = String(billNumber);
    const amt = String(amount);
    const url = pdfUrl || "";

    // Try WhatsApp first if configured
    if (waNumber && waTemplate) {
      const wa = await sendWhatsApp(apiKey, waNumber, waTemplate, normalized, name, bill, amt, url);
      if (wa.ok) {
        return new Response(
          JSON.stringify({ ok: true, channel: "whatsapp" }),
          { headers: { ...CORS, "Content-Type": "application/json" } },
        );
      }
      // WhatsApp failed — fall through to SMS
    }

    // SMS (primary or fallback)
    const sms = await sendSms(apiKey, templateId, senderId, normalized, name, bill, amt, url);
    if (!sms.ok) {
      return new Response(JSON.stringify({ error: sms.error }), { status: 502, headers: CORS });
    }

    return new Response(
      JSON.stringify({ ok: true, channel: "sms", requestId: sms.requestId }),
      { headers: { ...CORS, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
  }
});
