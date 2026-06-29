import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DISCOUNT_TIERS = [
  { min: 6_000_000, rate: 0.28 },
  { min: 3_000_000, rate: 0.24 },
  { min: 1_200_000, rate: 0.20 },
  { min: 600_000, rate: 0.16 },
  { min: 300_000, rate: 0.13 },
  { min: 150_000, rate: 0.10 },
  { min: 50_000, rate: 0.07 },
];

function getTargetDiscount(estimatedValueCHF: number): number | null {
  for (const tier of DISCOUNT_TIERS) {
    if (estimatedValueCHF >= tier.min) return tier.rate;
  }
  return null; // below 50k — not enough volume
}

function datesOverlap(
  aVon: string, aBis: string,
  bVon: string, bBis: string,
  minOverlapDays = 3
): boolean {
  const a0 = new Date(aVon).getTime();
  const a1 = new Date(aBis).getTime();
  const b0 = new Date(bVon).getTime();
  const b1 = new Date(bBis).getTime();
  const overlapStart = Math.max(a0, b0);
  const overlapEnd = Math.min(a1, b1);
  const overlapMs = overlapEnd - overlapStart;
  return overlapMs >= minOverlapDays * 86_400_000;
}

interface MaterialRequest {
  id: string;
  sourceon_id: string;
  menge: number;
  einheit: string;
  liefer_zone: string;
  liefer_zeitraum_von: string;
  liefer_zeitraum_bis: string;
  fallback_deadline: string | null;
}

interface RequestGroup {
  sourceon_id: string;
  liefer_zone: string;
  liefer_zeitraum_von: string; // earliest
  liefer_zeitraum_bis: string; // latest
  totalMenge: number;
  einheit: string;
  requests: MaterialRequest[];
}

Deno.serve(async (req: Request) => {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, supabaseKey);

    // 1. Fetch open, unbundled material requests
    const { data: openRequests, error: fetchErr } = await sb
      .from("material_requests")
      .select("id, sourceon_id, menge, einheit, liefer_zone, liefer_zeitraum_von, liefer_zeitraum_bis, fallback_deadline")
      .eq("status", "offen")
      .is("bundle_id", null);

    if (fetchErr) {
      return Response.json({ error: "Failed to fetch requests", detail: fetchErr.message }, { status: 500 });
    }

    if (!openRequests || openRequests.length === 0) {
      return Response.json({ message: "No open unbundled requests found", bundlesCreated: 0 });
    }

    // Fetch material catalog for einheit + richtpreis_chf lookup
    const { data: catalog } = await sb
      .from("material_catalog")
      .select("sourceon_id, einheit, richtpreis_chf");
    const catalogMap: Record<string, { einheit: string; richtpreis: number | null }> = {};
    if (catalog) {
      for (const c of catalog) {
        catalogMap[c.sourceon_id] = { einheit: c.einheit, richtpreis: c.richtpreis_chf };
      }
    }

    // 2. Group by sourceon_id + liefer_zone + overlapping delivery windows
    const groups: RequestGroup[] = [];

    for (const req of openRequests as MaterialRequest[]) {
      if (!req.menge || !req.sourceon_id || !req.liefer_zone) continue;
      if (!req.liefer_zeitraum_von || !req.liefer_zeitraum_bis) continue;

      let placed = false;
      for (const g of groups) {
        if (
          g.sourceon_id === req.sourceon_id &&
          g.liefer_zone === req.liefer_zone &&
          datesOverlap(
            g.liefer_zeitraum_von, g.liefer_zeitraum_bis,
            req.liefer_zeitraum_von, req.liefer_zeitraum_bis
          )
        ) {
          g.requests.push(req);
          g.totalMenge += Number(req.menge);
          // Expand the group's delivery window to the union
          if (req.liefer_zeitraum_von < g.liefer_zeitraum_von) {
            g.liefer_zeitraum_von = req.liefer_zeitraum_von;
          }
          if (req.liefer_zeitraum_bis > g.liefer_zeitraum_bis) {
            g.liefer_zeitraum_bis = req.liefer_zeitraum_bis;
          }
          placed = true;
          break;
        }
      }

      if (!placed) {
        groups.push({
          sourceon_id: req.sourceon_id,
          liefer_zone: req.liefer_zone,
          liefer_zeitraum_von: req.liefer_zeitraum_von,
          liefer_zeitraum_bis: req.liefer_zeitraum_bis,
          totalMenge: Number(req.menge),
          einheit: req.einheit || catalogMap[req.sourceon_id]?.einheit || "Stk",
          requests: [req],
        });
      }
    }

    // 3-6. Create bundles for qualifying groups
    const summary: Array<{
      sourceon_id: string;
      liefer_zone: string;
      totalMenge: number;
      einheit: string;
      estimatedCHF: number;
      targetDiscount: number;
      requestCount: number;
    }> = [];
    const skipped: Array<{ sourceon_id: string; liefer_zone: string; estimatedCHF: number; reason: string }> = [];

    for (const g of groups) {
      const catEntry = catalogMap[g.sourceon_id];
      const richtpreis = catEntry?.richtpreis ?? null;
      if (richtpreis === null) {
        console.warn(`[auto-bundle] No richtpreis_chf for sourceon_id "${g.sourceon_id}" — skipping group`);
        skipped.push({
          sourceon_id: g.sourceon_id,
          liefer_zone: g.liefer_zone,
          estimatedCHF: 0,
          reason: `No richtpreis_chf in material_catalog for ${g.sourceon_id}`,
        });
        continue;
      }
      const estimatedCHF = g.totalMenge * richtpreis;
      const discount = getTargetDiscount(estimatedCHF);

      if (discount === null) {
        // Check if any requests in this group have passed their fallback deadline
        const now = new Date().toISOString();
        const expiredRequests = g.requests.filter(
          (r) => r.fallback_deadline && r.fallback_deadline <= now
        );

        if (expiredRequests.length > 0) {
          // Fallback: create bundle at lowest tier (7%) even below threshold
          const bidDeadline = new Date();
          bidDeadline.setDate(bidDeadline.getDate() + 7);

          const { data: fbBundle, error: fbInsertErr } = await sb
            .from("bundles")
            .insert({
              sourceon_id: g.sourceon_id,
              liefer_zone: g.liefer_zone,
              liefer_zeitraum_von: g.liefer_zeitraum_von,
              liefer_zeitraum_bis: g.liefer_zeitraum_bis,
              gesamtvolumen: g.totalMenge,
              einheit: g.einheit,
              ziel_mindestrabatt: 0.07,
              status: "ausgeschrieben",
              bid_deadline: bidDeadline.toISOString(),
              bundle_type: "single_material",
              is_fallback_bundle: true,
            })
            .select("id")
            .single();

          if (!fbInsertErr && fbBundle) {
            const reqIds = g.requests.map((r) => r.id);
            await sb
              .from("material_requests")
              .update({ bundle_id: fbBundle.id, status: "gebuendelt" })
              .in("id", reqIds);

            console.log(
              `[auto-bundle] FALLBACK bundle for ${g.sourceon_id}/${g.liefer_zone} ` +
              `(~${Math.round(estimatedCHF)} CHF, ${expiredRequests.length} expired) → 7% tier`
            );
            summary.push({
              sourceon_id: g.sourceon_id,
              liefer_zone: g.liefer_zone,
              totalMenge: g.totalMenge,
              einheit: g.einheit,
              estimatedCHF: Math.round(estimatedCHF),
              targetDiscount: 0.07,
              requestCount: reqIds.length,
            });
            continue;
          }
        }

        skipped.push({
          sourceon_id: g.sourceon_id,
          liefer_zone: g.liefer_zone,
          estimatedCHF: Math.round(estimatedCHF),
          reason: `Below 50k CHF threshold (${Math.round(estimatedCHF)} CHF)`,
        });
        continue;
      }

      const bidDeadline = new Date();
      bidDeadline.setDate(bidDeadline.getDate() + 7);

      // 5. Create bundle
      const { data: bundle, error: insertErr } = await sb
        .from("bundles")
        .insert({
          sourceon_id: g.sourceon_id,
          liefer_zone: g.liefer_zone,
          liefer_zeitraum_von: g.liefer_zeitraum_von,
          liefer_zeitraum_bis: g.liefer_zeitraum_bis,
          gesamtvolumen: g.totalMenge,
          einheit: g.einheit,
          ziel_mindestrabatt: discount,
          status: "ausgeschrieben",
          bid_deadline: bidDeadline.toISOString(),
          bundle_type: "single_material",
        })
        .select("id")
        .single();

      if (insertErr || !bundle) {
        console.error(`Failed to create bundle for ${g.sourceon_id}/${g.liefer_zone}:`, insertErr);
        continue;
      }

      // 6. Update material_requests with bundle_id and status
      const requestIds = g.requests.map((r) => r.id);
      const { error: updateErr } = await sb
        .from("material_requests")
        .update({ bundle_id: bundle.id, status: "gebuendelt" })
        .in("id", requestIds);

      if (updateErr) {
        console.error(`Failed to update requests for bundle ${bundle.id}:`, updateErr);
      }

      summary.push({
        sourceon_id: g.sourceon_id,
        liefer_zone: g.liefer_zone,
        totalMenge: g.totalMenge,
        einheit: g.einheit,
        estimatedCHF: Math.round(estimatedCHF),
        targetDiscount: discount,
        requestCount: requestIds.length,
      });
    }

    // 7. Log summary
    console.log(`[auto-bundle] Created ${summary.length} bundle(s), skipped ${skipped.length} group(s)`);
    for (const s of summary) {
      console.log(
        `  Bundle: ${s.sourceon_id} / ${s.liefer_zone} — ${s.totalMenge} ${s.einheit} ` +
        `(~${s.estimatedCHF} CHF) → ${(s.targetDiscount * 100).toFixed(0)}% target, ${s.requestCount} requests`
      );
    }

    return Response.json({
      bundlesCreated: summary.length,
      groupsSkipped: skipped.length,
      bundles: summary,
      skipped,
      openRequestsProcessed: openRequests.length,
    });
  } catch (err) {
    console.error("[auto-bundle] Unexpected error:", err);
    return Response.json({ error: "Internal error", detail: String(err) }, { status: 500 });
  }
});
