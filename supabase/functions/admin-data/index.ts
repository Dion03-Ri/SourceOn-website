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

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // --- Clerk-Token + admins-Tabelle ---
  const adminId = await requireAdmin(req);
  if (!adminId) return json({ error: "forbidden" }, 403);

  let body: { action?: string; id?: string; ziel_mindestrabatt?: number; bid_deadline?: string };
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  const action = body.action;

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

      default:
        return json({ error: "unknown_action" }, 400);
    }
  } catch (e) {
    return json({ error: "server_error", detail: String(e) }, 500);
  }
});
