// admin-data — server-side admin API for adminoverview.html.
//
// SECURITY: The Supabase service_role key must NEVER live in client code. This
// function holds it server-side (via the auto-injected SUPABASE_SERVICE_ROLE_KEY
// env) and exposes only a fixed set of admin actions, gated by a shared secret
// header (x-admin-secret === ADMIN_SECRET). The shared secret can only invoke
// this specific function — it cannot run arbitrary queries against the database.
//
// Deploy:  supabase functions deploy admin-data --no-verify-jwt
// Secret:  supabase secrets set ADMIN_SECRET="<a long random string>"
//          (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are injected automatically)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-secret",
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // --- Shared-secret auth ---
  const secret = Deno.env.get("ADMIN_SECRET");
  if (!secret || req.headers.get("x-admin-secret") !== secret) {
    return json({ error: "unauthorized" }, 401);
  }

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
        const [customers, requests] = await Promise.all([
          sb.from("customers").select("*").order("created_at", { ascending: false }),
          sb.from("material_requests").select("customer_id"),
        ]);
        return json({ customers: customers.data ?? [], requests: requests.data ?? [] });
      }
      case "all_requests": {
        const [requests, customers] = await Promise.all([
          sb.from("material_requests").select("*").order("created_at", { ascending: false }),
          sb.from("customers").select("id,firmenname"),
        ]);
        return json({ requests: requests.data ?? [], customers: customers.data ?? [] });
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
