import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  try {
    // --- Interner Auth-Check (gleiches Muster wie ai-supplier-check) ---
    // Verify JWT ist AUS; die Function wird nur vom pg_cron-Job aufgerufen, der
    // den geheimen Header x-ai-secret mitschickt. Ohne diesen Header waere die
    // Function fuer jeden im Internet aufrufbar (Compute-/DoS-Hebel).
    const triggerSecret = Deno.env.get("AI_TRIGGER_SECRET");
    if (!triggerSecret || req.headers.get("x-ai-secret") !== triggerSecret) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, supabaseKey);

    // 1. Find all expired bundles still marked as 'ausgeschrieben'
    const { data: expiredBundles, error: fetchErr } = await sb
      .from("bundles")
      .select("id, sourceon_id, gesamtvolumen, einheit, liefer_zone, ziel_mindestrabatt, bid_deadline")
      .eq("status", "ausgeschrieben")
      .lt("bid_deadline", new Date().toISOString());

    if (fetchErr) {
      return Response.json({ error: "Failed to fetch expired bundles", detail: fetchErr.message }, { status: 500 });
    }

    if (!expiredBundles || expiredBundles.length === 0) {
      return Response.json({ message: "No expired bundles found", vergeben: 0, abgelaufen: 0 });
    }

    let vergebenCount = 0;
    let abgelaufenCount = 0;

    for (const bundle of expiredBundles) {
      // 2. Fetch all bids for this bundle
      const { data: bids, error: bidsErr } = await sb
        .from("bids")
        .select("id, supplier_id, rabatt_prozent, status")
        .eq("bundle_id", bundle.id)
        .order("rabatt_prozent", { ascending: false });

      if (bidsErr) {
        console.error(`[resolve-expired] Failed to fetch bids for bundle ${bundle.id}:`, bidsErr);
        continue;
      }

      const minDiscount = bundle.ziel_mindestrabatt
        ? (bundle.ziel_mindestrabatt < 1 ? bundle.ziel_mindestrabatt * 100 : bundle.ziel_mindestrabatt)
        : 0;

      // Find qualifying bids (rabatt_prozent >= ziel_mindestrabatt)
      const qualifying = (bids || []).filter((bid) => {
        const rabatt = Number(bid.rabatt_prozent || 0);
        return rabatt >= minDiscount;
      });

      if (qualifying.length > 0) {
        // 3a. Winner: highest rabatt_prozent
        const winner = qualifying[0];
        const losers = (bids || []).filter((bid) => bid.id !== winner.id);

        // Update bundle
        const { error: bundleErr } = await sb
          .from("bundles")
          .update({
            status: "vergeben",
            gewonnener_supplier_id: winner.supplier_id,
            finaler_rabatt: winner.rabatt_prozent,
          })
          .eq("id", bundle.id);

        if (bundleErr) {
          console.error(`[resolve-expired] Failed to update bundle ${bundle.id} to vergeben:`, bundleErr);
          continue;
        }

        // Update winning bid
        await sb.from("bids").update({ status: "gewonnen" }).eq("id", winner.id);

        // Update losing bids
        if (losers.length > 0) {
          await sb
            .from("bids")
            .update({ status: "verloren" })
            .in("id", losers.map((l) => l.id));
        }

        // Update related material_requests
        await sb
          .from("material_requests")
          .update({ status: "vergeben" })
          .eq("bundle_id", bundle.id);

        console.log(
          `[resolve-expired] Bundle ${bundle.id} (${bundle.sourceon_id}/${bundle.liefer_zone}) → ` +
          `VERGEBEN to ${winner.supplier_id} at ${winner.rabatt_prozent}% ` +
          `(${qualifying.length} qualifying, ${losers.length} lost)`
        );
        vergebenCount++;
      } else {
        // 3b. No qualifying bids — mark as abgelaufen
        await sb
          .from("bundles")
          .update({ status: "abgelaufen" })
          .eq("id", bundle.id);

        // Mark all bids as verloren
        if (bids && bids.length > 0) {
          await sb
            .from("bids")
            .update({ status: "verloren" })
            .in("id", bids.map((bid) => bid.id));
        }

        // Leave material_requests as-is for admin decision

        console.log(
          `[resolve-expired] Bundle ${bundle.id} (${bundle.sourceon_id}/${bundle.liefer_zone}) → ` +
          `ABGELAUFEN (${(bids || []).length} bids, 0 qualifying, min ${minDiscount}%)`
        );
        abgelaufenCount++;
      }
    }

    console.log(
      `[resolve-expired] Done: ${vergebenCount} vergeben, ${abgelaufenCount} abgelaufen ` +
      `(${expiredBundles.length} total expired)`
    );

    return Response.json({
      processed: expiredBundles.length,
      vergeben: vergebenCount,
      abgelaufen: abgelaufenCount,
    });
  } catch (err) {
    console.error("[resolve-expired] Unexpected error:", err);
    return Response.json({ error: "Internal error", detail: String(err) }, { status: 500 });
  }
});
