// admin-data — server-side admin API for adminoverview.html.
//
// SECURITY: Zugriff nur fuer echte Admins. Der Aufrufer schickt seinen CLERK-
// Session-Token (Authorization: Bearer). Diese Function verifiziert die Signatur
// serverseitig gegen Clerks JWKS und prueft, ob der Nutzer-sub in der Tabelle
// public.admins steht. Kein im Browser sichtbares Shared Secret mehr.
// Der Supabase service_role/secret key bleibt serverseitig (nie im Client).
//
// Deploy:  supabase functions deploy admin-data --no-verify-jwt
//          (Verify JWT MUSS AUS sein — die Function verifiziert den Clerk-Token selbst.)
// Voraussetzung: Tabelle public.admins (siehe supabase/admins.sql).

import { createClient } from "npm:@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify } from "https://esm.sh/jose@5";

const CLERK_ISSUER = "https://tolerant-skink-62.clerk.accounts.dev";
const JWKS = createRemoteJWKSet(new URL(CLERK_ISSUER + "/.well-known/jwks.json"));

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// Verifiziert den Clerk-Token und gibt den sub zurueck, wenn der Nutzer Admin ist.
async function requireAdmin(req: Request): Promise<string | null> {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  let sub: string | null = null;
  try {
    const { payload } = await jwtVerify(token, JWKS, { issuer: CLERK_ISSUER });
    sub = (payload.sub as string) || null;
  } catch { return null; }        // ungueltige/abgelaufene Signatur
  if (!sub) return null;
  const { data } = await sb.from("admins").select("user_id").eq("user_id", sub).maybeSingle();
  return data ? sub : null;       // nur wenn in admins-Tabelle
}

// Nur Clerk-Token verifizieren (ohne Admin-Pruefung) — fuer Supplier-Aktionen.
async function verifiedSub(req: Request): Promise<string | null> {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, JWKS, { issuer: CLERK_ISSUER });
    return (payload.sub as string) || null;
  } catch { return null; }
}

// Supplier-facing: NUR der Gewinner-Lieferant eines vergebenen Bundles erhaelt die
// Liefer-/Kundendetails (Kunden-PII). Verifiziert Clerk-Token und prueft, dass der
// sub == bundles.gewonnener_supplier_id ist. Sonst 403.
async function handleWonOrderDetails(req: Request, bundleId?: string): Promise<Response> {
  const sub = await verifiedSub(req);
  if (!sub) return json({ error: "unauthorized" }, 401);
  if (!bundleId) return json({ error: "missing_id" }, 400);
  const { data: bundle } = await sb.from("bundles")
    .select("id, sourceon_id, liefer_zone, bid_deadline, gesamtvolumen, einheit, gewonnener_supplier_id, status")
    .eq("id", bundleId).maybeSingle();
  if (!bundle || bundle.status !== "vergeben" || bundle.gewonnener_supplier_id !== sub) {
    return json({ error: "forbidden" }, 403);
  }
  const { data: mr } = await sb.from("material_requests")
    .select("menge, einheit, liefer_zeitraum_von, liefer_zeitraum_bis, customer_id")
    .eq("bundle_id", bundleId).eq("status", "vergeben");
  const custIds = [...new Set((mr ?? []).map((r) => r.customer_id))];
  const custMap: Record<string, unknown> = {};
  if (custIds.length) {
    const { data: custs } = await sb.from("customers")
      .select("id, firmenname, ansprechperson, telefon, email, lieferadresse")
      .in("id", custIds);
    (custs ?? []).forEach((c: { id: string }) => { custMap[c.id] = c; });
  }
  const customers = (mr ?? []).map((r) => ({
    menge: r.menge, einheit: r.einheit,
    liefer_zeitraum_von: r.liefer_zeitraum_von, liefer_zeitraum_bis: r.liefer_zeitraum_bis,
    ...(custMap[r.customer_id] as Record<string, unknown> || {}),
  }));
  const { data: cat } = await sb.from("material_catalog")
    .select("bezeichnung").eq("sourceon_id", bundle.sourceon_id).maybeSingle();
  return json({
    bundle: {
      sourceon_id: bundle.sourceon_id, bezeichnung: cat?.bezeichnung ?? null,
      liefer_zone: bundle.liefer_zone, bid_deadline: bundle.bid_deadline,
      gesamtvolumen: bundle.gesamtvolumen, einheit: bundle.einheit,
    },
    customers,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: { action?: string; id?: string; ziel_mindestrabatt?: number; bid_deadline?: string };
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  const action = body.action;

  // Supplier-facing Aktion (eigene Auth, KEIN Admin noetig):
  if (action === "won_order_details") return await handleWonOrderDetails(req, body.id);

  // --- Alles andere: nur Admins (Clerk-Token + admins-Tabelle) ---
  const adminId = await requireAdmin(req);
  if (!adminId) return json({ error: "forbidden" }, 403);

  try {
    switch (action) {
      // ---------------- READS ----------------
      case "stats": {
        const [bundles, suppliers, customers, requests] = await Promise.all([
          sb.from("bundles").select("status,gesamtvolumen,gewonnener_supplier_id"),
          sb.from("suppliers").select("status"),
          sb.from("customers").select("id"),
          sb.from("material_requests").select("status,sourceon_id,committed_min_rabatt,commitment_accepted"),
        ]);
        return json({
          bundles: bundles.data ?? [],
          suppliers: suppliers.data ?? [],
          customers: customers.data ?? [],
          requests: requests.data ?? [],
        });
      }
      case "pending_suppliers": {
        const { data } = await sb.from("suppliers").select("*")
          .eq("status", "pending").order("created_at", { ascending: false });
        return json({ data: data ?? [] });
      }
      case "all_suppliers": {
        const { data } = await sb.from("suppliers").select("*")
          .order("created_at", { ascending: false });
        return json({ data: data ?? [] });
      }
      case "all_customers": {
        // Full request details too, so the admin can expand a customer's requests.
        const [customers, requests] = await Promise.all([
          sb.from("customers").select("*").order("created_at", { ascending: false }),
          sb.from("material_requests").select("*").order("created_at", { ascending: false }),
        ]);
        return json({ customers: customers.data ?? [], requests: requests.data ?? [] });
      }
      case "all_bundles": {
        const [bundles, bids, suppliers] = await Promise.all([
          sb.from("bundles").select("*").order("created_at", { ascending: false }),
          sb.from("bids").select("bundle_id"),
          sb.from("suppliers").select("id,company_name"),
        ]);
        return json({ bundles: bundles.data ?? [], bids: bids.data ?? [], suppliers: suppliers.data ?? [] });
      }
      case "expired_bundles": {
        const [bundles, bids] = await Promise.all([
          sb.from("bundles").select("*").eq("status", "abgelaufen").order("created_at", { ascending: false }),
          sb.from("bids").select("id,bundle_id,rabatt_prozent,supplier_id"),
        ]);
        return json({ bundles: bundles.data ?? [], bids: bids.data ?? [] });
      }

      // ---------------- WRITES ----------------
      case "verify_supplier": {
        if (!body.id) return json({ error: "missing_id" }, 400);
        const { error } = await sb.from("suppliers").update({ status: "verified" }).eq("id", body.id);
        return json({ ok: !error });
      }
      case "reject_supplier": {
        if (!body.id) return json({ error: "missing_id" }, 400);
        const { error } = await sb.from("suppliers").update({ status: "rejected" }).eq("id", body.id);
        return json({ ok: !error });
      }
      case "republish_bundle": {
        if (!body.id) return json({ error: "missing_id" }, 400);
        const upd: Record<string, unknown> = {
          status: "ausgeschrieben",
          gewonnener_supplier_id: null,
          finaler_rabatt: null,
        };
        if (body.bid_deadline) upd.bid_deadline = body.bid_deadline;
        if (body.ziel_mindestrabatt != null) {
          const r = Number(body.ziel_mindestrabatt);
          upd.ziel_mindestrabatt = r > 1 ? r / 100 : r;
        }
        const { error } = await sb.from("bundles").update(upd).eq("id", body.id);
        if (error) return json({ ok: false });
        await sb.from("bids").delete().eq("bundle_id", body.id);
        return json({ ok: true });
      }
      case "remove_bundle": {
        if (!body.id) return json({ error: "missing_id" }, 400);
        // Reset associated requests to 'offen', drop bids, then delete the bundle.
        await sb.from("material_requests").update({ status: "offen", bundle_id: null }).eq("bundle_id", body.id);
        await sb.from("bids").delete().eq("bundle_id", body.id);
        const { error } = await sb.from("bundles").delete().eq("id", body.id);
        return json({ ok: !error });
      }

      // ---------------- PROVISIONEN ----------------
      case "pending_provisions": {
        const [bundles, suppliers, catalog] = await Promise.all([
          sb.from("bundles").select("*").eq("status", "vergeben").order("created_at", { ascending: false }),
          sb.from("suppliers").select("id,company_name,email"),
          sb.from("material_catalog").select("sourceon_id,richtpreis_chf,bezeichnung"),
        ]);
        const catMap: Record<string, { richtpreis_chf: number | null; bezeichnung: string | null }> = {};
        (catalog.data ?? []).forEach((c: { sourceon_id: string; richtpreis_chf: number | null; bezeichnung: string | null }) => { catMap[c.sourceon_id] = c; });
        const supMap: Record<string, { company_name: string | null; email: string | null }> = {};
        (suppliers.data ?? []).forEach((s: { id: string; company_name: string | null; email: string | null }) => { supMap[s.id] = s; });
        const rows = (bundles.data ?? []).map((b: Record<string, unknown>) => {
          const rp = Number(catMap[b.sourceon_id as string]?.richtpreis_chf ?? 0);
          const estimatedCHF = Number(b.gesamtvolumen ?? 0) * rp;
          const provision = estimatedCHF * 0.0225;
          const sup = supMap[b.gewonnener_supplier_id as string] || null;
          return {
            id: b.id, sourceon_id: b.sourceon_id, bezeichnung: catMap[b.sourceon_id as string]?.bezeichnung ?? null,
            gesamtvolumen: b.gesamtvolumen, einheit: b.einheit, liefer_zone: b.liefer_zone,
            finaler_rabatt: b.finaler_rabatt, bid_deadline: b.bid_deadline, created_at: b.created_at,
            gewonnener_supplier_id: b.gewonnener_supplier_id,
            supplier_name: sup?.company_name ?? null, supplier_email: sup?.email ?? null,
            estimatedCHF, provision, provision_collected: !!b.provision_collected,
          };
        });
        return json({ rows });
      }
      case "mark_provision_collected": {
        if (!body.id) return json({ error: "missing_id" }, 400);
        const { error } = await sb.from("bundles").update({ provision_collected: true }).eq("id", body.id);
        return json({ ok: !error });
      }

      default:
        return json({ error: "unknown_action" }, 400);
    }
  } catch (e) {
    return json({ error: "server_error", detail: String(e) }, 500);
  }
});
