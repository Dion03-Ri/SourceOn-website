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

// ---------------------------------------------------------------------------
// Dynamische Timing-Formeln (Sammelfenster + Gebotsfrist).
// ⚠️ MÜSSEN synchron bleiben mit /timing.js (Kunden-Dashboard-Anzeige) und dem
// Tempo-Indikator in kontakt.html. Jede Änderung hier dort ebenfalls nachziehen.
// ---------------------------------------------------------------------------
const DAY_MS = 86_400_000;
function midnight(d: Date): Date { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function availableDaysFromToday(vonISO: string): number {
  return Math.floor((midnight(new Date(vonISO)).getTime() - midnight(new Date()).getTime()) / DAY_MS);
}
function bidDeadlineDays(availableDays: number): number {
  if (availableDays >= 16) return 7;
  if (availableDays >= 12) return 5;
  if (availableDays >= 9) return 3;
  return 2; // Minimum
}
// collection_end = liefer_zeitraum_von − (bidDeadlineDays + 2 Tage Puffer),
// jedoch nie später als created_at + 14 Tage (bestehende Fallback-Obergrenze).
function collectionEnd(vonISO: string, createdAtISO: string | null): Date {
  const bdd = bidDeadlineDays(availableDaysFromToday(vonISO));
  const ce = new Date(vonISO);
  ce.setDate(ce.getDate() - (bdd + 2));
  if (createdAtISO) {
    const cap = new Date(createdAtISO);
    cap.setDate(cap.getDate() + 14);
    if (ce.getTime() > cap.getTime()) return cap;
  }
  return ce;
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
  created_at: string | null;
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
    // NOTE (commitment constraint — not yet enforced): committed_min_rabatt is the
    // minimum discount each customer was guaranteed at request time. A future change
    // should ensure a bundle's ziel_mindestrabatt >= the HIGHEST committed_min_rabatt
    // among its member requests, so no customer is bundled below their guaranteed
    // minimum. Do NOT change bundling logic here yet — the column is selected so the
    // constraint can be implemented later.
    const { data: openRequests, error: fetchErr } = await sb
      .from("material_requests")
      .select("id, sourceon_id, menge, einheit, liefer_zone, liefer_zeitraum_von, liefer_zeitraum_bis, fallback_deadline, committed_min_rabatt, created_at")
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

    const nowMs = Date.now();

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
      const discount = getTargetDiscount(estimatedCHF); // null if < 50k

      // --- Window-based timing: evaluate every request in the group ---
      // The group publishes when the EARLIEST collection_end among its requests is
      // reached; until then it keeps collecting partners (large orders wait too —
      // their committed minimum discount is guaranteed regardless).
      let groupCollEnd: Date | null = null;   // earliest collection_end
      let earliestVon: string | null = null;  // most urgent (closest delivery)
      let urgentBidDays = 7;                   // bid_deadline_days of the most urgent request
      for (const r of g.requests) {
        const avail = availableDaysFromToday(r.liefer_zeitraum_von);
        const bdd = bidDeadlineDays(avail);
        const ce = collectionEnd(r.liefer_zeitraum_von, r.created_at ?? r.fallback_deadline ?? null);
        console.log(
          `[auto-bundle] eval req ${r.id} (${g.sourceon_id}/${g.liefer_zone}): ` +
          `availDays=${avail}, bidDeadlineDays=${bdd}, collectionEnd=${ce.toISOString().slice(0, 10)}`
        );
        if (groupCollEnd === null || ce.getTime() < groupCollEnd.getTime()) groupCollEnd = ce;
        if (earliestVon === null || r.liefer_zeitraum_von < earliestVon) {
          earliestVon = r.liefer_zeitraum_von;
          urgentBidDays = bdd;
        }
      }

      // Not yet time to publish → keep collecting (also large ≥50k groups wait).
      if (groupCollEnd && nowMs < groupCollEnd.getTime()) {
        console.log(
          `[auto-bundle] group ${g.sourceon_id}/${g.liefer_zone} STILL COLLECTING ` +
          `until ${groupCollEnd.toISOString().slice(0, 10)} ` +
          `(~${Math.round(estimatedCHF)} CHF, ${g.requests.length} req, tier ${discount === null ? "<50k" : (discount * 100) + "%"})`
        );
        skipped.push({
          sourceon_id: g.sourceon_id,
          liefer_zone: g.liefer_zone,
          estimatedCHF: Math.round(estimatedCHF),
          reason: `Collecting until ${groupCollEnd.toISOString().slice(0, 10)}`,
        });
        continue;
      }

      // collection_end reached → PUBLISH now.
      // bid_deadline uses the bid_deadline_days of the MOST URGENT request so the
      // auction always finishes in time for every member's delivery.
      const bidDeadline = new Date();
      bidDeadline.setDate(bidDeadline.getDate() + urgentBidDays);

      const isFallback = discount === null;
      const targetRabatt = isFallback ? 0.07 : (discount as number);

      const { data: bundle, error: insertErr } = await sb
        .from("bundles")
        .insert({
          sourceon_id: g.sourceon_id,
          liefer_zone: g.liefer_zone,
          liefer_zeitraum_von: g.liefer_zeitraum_von,
          liefer_zeitraum_bis: g.liefer_zeitraum_bis,
          gesamtvolumen: g.totalMenge,
          einheit: g.einheit,
          ziel_mindestrabatt: targetRabatt,
          status: "ausgeschrieben",
          bid_deadline: bidDeadline.toISOString(),
          bundle_type: "single_material",
          is_fallback_bundle: isFallback,
        })
        .select("id")
        .single();

      if (insertErr || !bundle) {
        console.error(`Failed to create bundle for ${g.sourceon_id}/${g.liefer_zone}:`, insertErr);
        continue;
      }

      const requestIds = g.requests.map((r) => r.id);
      const { error: updateErr } = await sb
        .from("material_requests")
        .update({ bundle_id: bundle.id, status: "gebuendelt" })
        .in("id", requestIds);
      if (updateErr) {
        console.error(`Failed to update requests for bundle ${bundle.id}:`, updateErr);
      }

      console.log(
        `[auto-bundle] PUBLISHED ${isFallback ? "FALLBACK " : ""}bundle ${g.sourceon_id}/${g.liefer_zone} — ` +
        `${g.totalMenge} ${g.einheit} (~${Math.round(estimatedCHF)} CHF) → ${(targetRabatt * 100).toFixed(0)}% target, ` +
        `${requestIds.length} req, bidDeadline=+${urgentBidDays}d ` +
        `(reason: collection_end ${groupCollEnd ? groupCollEnd.toISOString().slice(0, 10) : "?"} reached)`
      );

      summary.push({
        sourceon_id: g.sourceon_id,
        liefer_zone: g.liefer_zone,
        totalMenge: g.totalMenge,
        einheit: g.einheit,
        estimatedCHF: Math.round(estimatedCHF),
        targetDiscount: targetRabatt,
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
