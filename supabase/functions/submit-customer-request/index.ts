// submit-customer-request — öffentliches Materialbedarf-Formular (kontakt.html).
// Ersetzt die direkten anonymen INSERTs. Der Schreibzugriff läuft jetzt serverseitig
// mit dem Secret-Key, damit anon NICHT mehr direkt in customers/material_requests
// schreibt (schließt das 60-Sek-PII-Fenster).
//
// SICHERHEIT: liefer_zone und committed_min_rabatt werden SERVERSEITIG berechnet
// (aus PLZ bzw. aus dem Gesamt-Bestellwert), damit der Client den rechtlich
// verbindlichen Mindestrabatt nicht manipulieren kann.
//
// Deploy: Function "submit-customer-request", Verify JWT = AUS.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify } from "https://esm.sh/jose@5";

// Clerk-Token-Verifizierung: die Identitaet (user_id) darf NICHT aus dem Body
// geglaubt werden (Clerk-IDs sind nicht geheim). Wir verifizieren den mit-
// gesendeten Clerk-Session-Token und nehmen den sub daraus. Ohne gueltigen
// Token -> anonyme Einreichung (user_id bleibt null, spaeter verknuepft).
const CLERK_ISSUER = "https://tolerant-skink-62.clerk.accounts.dev";
const JWKS = createRemoteJWKSet(new URL(CLERK_ISSUER + "/.well-known/jwks.json"));

async function verifiedSub(req: Request): Promise<string | null> {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, JWKS, { issuer: CLERK_ISSUER });
    return (payload.sub as string) || null;
  } catch { return null; }
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// --- Rabattstufen (NET) — synchron mit /tiers.js -----------------------------
const TIERS: { min: number; net: number | null }[] = [
  { min: 6_000_000, net: null }, // > 6 Mio. -> individuell
  { min: 3_000_000, net: 0.35 },
  { min: 1_200_000, net: 0.30 },
  { min: 600_000,   net: 0.25 },
  { min: 300_000,   net: 0.20 },
  { min: 150_000,   net: 0.16 },
  { min: 50_000,    net: 0.12 },
  { min: 20_000,    net: 0.08 },
];
function netRate(v: number): number | null {
  for (const t of TIERS) { if (v >= t.min) return t.net; }
  return 0.08; // unter 20k
}
function parseQty(s: string): number {
  const n = parseFloat(String(s || "").replace(/'/g, "").replace(",", ".").replace(/[^0-9.]/g, ""));
  return isNaN(n) ? 0 : n;
}

// --- liefer_zone aus PLZ (Port von _zoneFromPlz in kontakt.html) -------------
function zoneFromPlz(plz: string): string {
  const n = parseInt(String(plz || "").replace(/\D/g, "").slice(0, 4), 10);
  if (isNaN(n)) return "Zürich";
  if ((n >= 7000 && n <= 7999) || (n >= 9000 && n <= 9999) || (n >= 8200 && n <= 8299) || (n >= 8500 && n <= 8599) || (n >= 8750 && n <= 8785)) return "Ostschweiz";
  if ((n >= 6300 && n <= 6399) || (n >= 6400 && n <= 6499) || (n >= 6050 && n <= 6078) || (n >= 8840 && n <= 8863)) return "Zentralschweiz";
  if (n >= 1000 && n <= 2999) return "Westschweiz";
  if (n >= 3900 && n <= 3999) return "Westschweiz";
  if (n >= 3000 && n <= 3899) return "Bern";
  if (n >= 4000 && n <= 4499) return "Basel";
  if (n >= 4500 && n <= 5999) return "Aargau";
  if (n >= 6000 && n <= 6299) return "Luzern";
  if (n >= 6500 && n <= 6999) return "Tessin";
  if (n >= 8000 && n <= 8749) return "Zürich";
  if (n >= 8800 && n <= 8839) return "Zürich";
  return "Zürich";
}

interface Body {
  firmenname?: string; ansprechperson?: string; email?: string; telefon?: string;
  strasse?: string; plz?: string; ort?: string;
  materials?: { sourceon_id: string; menge: string }[];
  liefer_zeitraum_von?: string; liefer_zeitraum_bis?: string;
  commitment_accepted?: boolean; commitment_version?: string;
  clerk_user_id?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "method_not_allowed" }, 405);

  let b: Body;
  try { b = await req.json(); } catch { return json({ success: false, error: "bad_request" }, 400); }

  const firmenname = (b.firmenname || "").trim();
  const ansprechperson = (b.ansprechperson || "").trim();
  const email = (b.email || "").trim();
  const telefon = (b.telefon || "").trim();
  const strasse = (b.strasse || "").trim();
  const plz = (b.plz || "").trim();
  const ort = (b.ort || "").trim();
  const von = b.liefer_zeitraum_von || null;
  const bis = b.liefer_zeitraum_bis || null;
  const materials = Array.isArray(b.materials) ? b.materials : [];

  if (!firmenname || !ansprechperson || !email || email.indexOf("@") < 1 || !telefon ||
      !strasse || !plz || !ort || !von || !bis || b.commitment_accepted !== true || materials.length === 0) {
    return json({ success: false, error: "missing_fields" }, 400);
  }

  const lieferadresse = `${strasse}, ${plz} ${ort}`;
  const zone = zoneFromPlz(plz);

  // Katalog für einheit + richtpreis der eingereichten Materialien laden.
  const ids = materials.map((m) => m.sourceon_id).filter(Boolean);
  const { data: catRows } = await sb.from("material_catalog")
    .select("sourceon_id, einheit, richtpreis_chf").in("sourceon_id", ids);
  const cat: Record<string, { einheit: string; richtpreis: number | null }> = {};
  (catRows ?? []).forEach((c: { sourceon_id: string; einheit: string; richtpreis_chf: number | null }) => {
    cat[c.sourceon_id] = { einheit: c.einheit, richtpreis: c.richtpreis_chf };
  });

  // Gesamt-Bestellwert -> Rabattstufe (serverseitig, manipulationssicher).
  let total = 0;
  for (const m of materials) {
    const rp = cat[m.sourceon_id]?.richtpreis;
    if (rp != null && !isNaN(Number(rp))) total += parseQty(m.menge) * Number(rp);
  }
  const committedRate = netRate(total); // fraction oder null (individuell)
  const committedAt = new Date().toISOString();
  const commitmentVersion = (b.commitment_version || "").toString().slice(0, 40) || "server";

  // Identitaet NUR aus dem verifizierten Clerk-Token — niemals aus dem Body.
  const userId = await verifiedSub(req);

  const custPayload: Record<string, unknown> = {
    firmenname, ansprechperson, email, telefon, lieferadresse, kanton: "",
  };
  if (userId) custPayload.user_id = userId;

  try {
    // Bestehenden Kunden wiederverwenden, wenn eingeloggt.
    let customerId: string | null = null;
    if (userId) {
      const ex = await sb.from("customers").select("id").eq("user_id", userId).limit(1).maybeSingle();
      if (ex.data) {
        customerId = ex.data.id;
        await sb.from("customers").update(custPayload).eq("id", customerId);
      }
    }
    if (!customerId) {
      const ins = await sb.from("customers").insert(custPayload).select("id").single();
      if (ins.error || !ins.data) return json({ success: false, error: ins.error?.message || "customer_insert_failed" }, 500);
      customerId = ins.data.id;
    }

    const rows = materials
      .filter((m) => m.sourceon_id && (m.menge || "").toString().trim())
      .map((m) => ({
        customer_id: customerId,
        sourceon_id: m.sourceon_id,
        menge: (m.menge || "").toString().trim(),
        einheit: cat[m.sourceon_id]?.einheit || "Stk",
        liefer_zeitraum_von: von,
        liefer_zeitraum_bis: bis,
        liefer_zone: zone,
        status: "offen",
        commitment_accepted: true,
        commitment_accepted_at: committedAt,
        committed_min_rabatt: committedRate,
        commitment_version: commitmentVersion,
      }));

    let requestIds: string[] = [];
    if (rows.length > 0) {
      const mr = await sb.from("material_requests").insert(rows).select("id");
      if (mr.error) return json({ success: false, error: mr.error.message }, 500);
      requestIds = (mr.data ?? []).map((r: { id: string }) => r.id);
    }

    return json({ success: true, customer_id: customerId, request_ids: requestIds });
  } catch (e) {
    return json({ success: false, error: String(e) }, 500);
  }
});
