// submit-special-request — öffentliches Formular "Material nicht in der Liste?"
// (sondermaterial.html). Ersetzt den direkten anonymen INSERT: der Schreibzugriff
// läuft jetzt serverseitig mit dem Secret-Key, damit anon NICHT mehr direkt in die
// DB schreiben kann. Öffentlicher Endpoint (keine Auth), nur ein validierter INSERT.
//
// Deploy: als Function "submit-special-request" anlegen, Verify JWT = AUS.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") || "";
  return xff.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}
// true = Limit ueberschritten. Fail-open bei Limiter-Fehler.
async function overLimit(bucket: string, ip: string, max: number, windowSec: number): Promise<boolean> {
  try {
    const { data, error } = await sb.rpc("rate_limit_hit", {
      p_bucket: bucket, p_identifier: ip, p_max: max, p_window_seconds: windowSec,
    });
    if (error) { console.error("[rate_limit_hit]", error.message); return false; }
    return data === false;
  } catch (e) { console.error("[rate_limit_hit]", e); return false; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "method_not_allowed" }, 405);

  // Spam-/Flood-Schutz: 5/Min und 30/Std pro IP.
  const ip = clientIp(req);
  if (await overLimit("special_min", ip, 5, 60) || await overLimit("special_hour", ip, 30, 3600)) {
    return json({ success: false, error: "rate_limited" }, 429);
  }

  let b: Record<string, string>;
  try { b = await req.json(); } catch { return json({ success: false, error: "bad_request" }, 400); }

  const firmenname = (b.firmenname || "").trim();
  const email = (b.email || "").trim();
  const material = (b.material_bezeichnung || "").trim();
  const menge = (b.menge || "").trim();

  if (!firmenname || !email || email.indexOf("@") < 1 || !material || !menge) {
    return json({ success: false, error: "missing_fields" }, 400);
  }

  const { error } = await sb.from("special_requests").insert({
    firmenname,
    email,
    material_bezeichnung: material,
    menge,
    liefer_zeitraum_von: b.liefer_zeitraum_von || null,
    liefer_zeitraum_bis: b.liefer_zeitraum_bis || null,
    verwendungszweck: b.verwendungszweck || null,
    bemerkungen: b.bemerkungen || null,
  });
  if (error) return json({ success: false, error: error.message }, 500);
  return json({ success: true });
});
