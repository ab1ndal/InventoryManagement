import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Comma-separated allowlist, e.g. "https://admin.example.com,http://localhost:3000".
const ALLOWED = (Deno.env.get("ALLOWED_ORIGIN") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

function corsHeaders(origin: string | null) {
  const allow = origin && ALLOWED.includes(origin) ? origin : ALLOWED[0] ?? "";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

serve(async (req) => {
  const origin = req.headers.get("origin");
  const CORS = corsHeaders(origin);

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // --- Auth: require a valid admin/superadmin JWT ---------------------------
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: CORS });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: CORS });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userData.user.id)
    .single();

  if (!profile || !["admin", "superadmin"].includes(profile.role)) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: CORS });
  }

  // --- Original WhatsApp send logic (unchanged) -----------------------------
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
