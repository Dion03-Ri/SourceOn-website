import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Rabattstufen (NETTO). Der an Lieferanten ausgeschriebene GROSS-Mindestrabatt
// (bundle.ziel_mindestrabatt) = net + 2.25% Provision; der Kunde erhält den NETTO-Wert.
// ⚠️ MUSS synchron bleiben mit /tiers.js (window.SO_TIERS).
const SUPPLIER_TIERS = [
  { min: 500, max: 4999, net: 0.05 },
  { min: 5000, max: 24999, net: 0.07 },
  { min: 25000, max: 49999, net: 0.10 },
  { min: 50000, max: 99999, net: 0.13 },
  { min: 100000, max: 249999, net: 0.16 },
  { min: 250000, max: 499999, net: 0.20 },
  { min: 500000, max: 999999, net: 0.24 },
  { min: 1000000, max: Infinity, net: 0.28 },
];
const COMMISSION = 0.0225;
const FALLBACK_GROSS = 0.0725; // unter CHF 500 (Fallback) → net 0.05 + Provision

// Liefert den NETTO-Tarifsatz fuer ein Gesamtvolumen (0, wenn < CHF 500).
function getNetTier(estimatedValueCHF: number): number {
  for (const tier of SUPPLIER_TIERS) {
    if (estimatedValueCHF >= tier.min && estimatedValueCHF <= tier.max) return tier.net;
  }
  return 0; // below 500
}

// Liefert den auszuschreibenden GROSS-Mindestrabatt (net + Provision) oder null (< 500 → Fallback).
function getGrossTarget(estimatedValueCHF: number): number | null {
  const net = getNetTier(estimatedValueCHF);
  return net > 0 ? net + COMMISSION : null;
}

// ---------------------------------------------------------------------------
// Dynamische Timing-Formeln (Sammelfenster + Gebotsfrist).
// ⚠️ MÜSSEN synchron bleiben mit /timing.js (Kunden-Dashboard-Anzeige) und dem
// Tempo-Indikator in kontakt.html. Jede Änderung hier dort ebenfalls nachziehen.
// ---------------------------------------------------------------------------
const DAY_MS = 86_400_000;
function midnight(d: Date): Date { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function availableDaysFromToday(dateISO: string): number {
  return Math.floor((midnight(new Date(dateISO)).getTime() - midnight(new Date()).getTime()) / DAY_MS);
}
function bidDeadlineDays(availableDays: number): number {
  if (availableDays >= 16) return 7;
  if (availableDays >= 12) return 5;
  if (availableDays >= 9) return 3;
  return 2; // Minimum
}
// Das Sammelfenster richtet sich nach dem SPÄTESTEN akzeptierten Liefertermin
// (liefer_zeitraum_bis): bis dahin darf geliefert werden, also bestimmt dieser
// Termin, wie lange gesammelt werden kann.
// collection_end = liefer_zeitraum_bis − (bidDeadlineDays + 2 Tage Puffer),
// jedoch nie später als created_at + 14 Tage (Sammelfenster-Obergrenze).
function collectionEnd(bisISO: string, createdAtISO: string | null): Date {
  const bdd = bidDeadlineDays(availableDaysFromToday(bisISO));
  const ce = new Date(bisISO);
  ce.setDate(ce.getDate() - (bdd + 2));
  if (createdAtISO) {
    const cap = new Date(createdAtISO);
    cap.setDate(cap.getDate() + 14);
    if (ce.getTime() > cap.getTime()) return cap;
  }
  return ce;
}

// Two delivery windows overlap if they intersect at all — inclusive, so windows
// that merely touch or are a single identical date (liefer_zeitraum_von ===
// liefer_zeitraum_bis) still count as overlapping. This ensures all requests
// with the same sourceon_id + liefer_zone and compatible dates land in ONE
// bundle instead of separate ones.
function datesOverlap(
  aVon: string, aBis: string,
  bVon: string, bBis: string,
): boolean {
  const a0 = new Date(aVon).getTime();
  const a1 = new Date(aBis).getTime();
  const b0 = new Date(bVon).getTime();
  const b1 = new Date(bBis).getTime();
  const overlapStart = Math.max(a0, b0);
  const overlapEnd = Math.min(a1, b1);
  return overlapEnd >= overlapStart;
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
  committed_min_rabatt: number | null; // NETTO-Mindestrabatt, den dieser Kunde bei Anfrage garantiert bekam
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
      const discount = getGrossTarget(estimatedCHF); // GROSS gross target, null if < 50k

      // --- Window-based timing: evaluate every request in the group ---
      // Timing is driven by each request's LATEST accepted delivery date
      // (liefer_zeitraum_bis). The group publishes when the EARLIEST collection_end
      // among its requests is reached — i.e. the member with the earliest
      // "Spätestens" is the binding deadline; until then it keeps collecting
      // partners (large orders wait too — their committed minimum discount is
      // guaranteed regardless). The 14-day cap in collectionEnd() still applies.
      let groupCollEnd: Date | null = null;   // earliest collection_end
      let earliestBis: string | null = null;  // most urgent (earliest latest-date)
      let urgentBidDays = 7;                   // bid_deadline_days of the most urgent request
      for (const r of g.requests) {
        const avail = availableDaysFromToday(r.liefer_zeitraum_bis);
        const bdd = bidDeadlineDays(avail);
        const ce = collectionEnd(r.liefer_zeitraum_bis, r.created_at ?? r.fallback_deadline ?? null);
        console.log(
          `[auto-bundle] eval req ${r.id} (${g.sourceon_id}/${g.liefer_zone}): ` +
          `availDays=${avail}, bidDeadlineDays=${bdd}, collectionEnd=${ce.toISOString().slice(0, 10)}`
        );
        if (groupCollEnd === null || ce.getTime() < groupCollEnd.getTime()) groupCollEnd = ce;
        if (earliestBis === null || r.liefer_zeitraum_bis < earliestBis) {
          earliestBis = r.liefer_zeitraum_bis;
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

      // target_discount = volumengewichteter Durchschnitt der individuell garantierten
      // NETTO-Mindestrabätte + 2.25% Provision (→ GROSS, wie an Lieferanten ausgeschrieben).
      // Bei einem Gebot GENAU auf die Zielmarke reicht der Gesamt-Rabatttopf exakt aus, um
      // JEDEM Kunden seinen eigenen Satz auf sein eigenes Volumen auszuzahlen
      // (SourceOn verteilt pro Kunde zu dessen committed_min_rabatt; ein Gebot ÜBER der
      // Zielmarke verteilt den Mehrwert proportional nach Volumen). Requests ohne festen
      // Satz (>6 Mio., committed_min_rabatt = null) werden übersprungen.
      let weightedNetSum = 0; // Σ(estimatedCHF_i × committed_min_rabatt_i)
      let ratedChfSum = 0;    // Σ(estimatedCHF_i) der bewerteten Requests
      for (const r of g.requests) {
        const c = r.committed_min_rabatt;
        if (c == null) continue;
        const rate = Number(c);
        if (isNaN(rate)) continue;
        const chf = Number(r.menge) * richtpreis;
        weightedNetSum += chf * rate;
        ratedChfSum += chf;
      }
      let targetRabatt: number;
      if (ratedChfSum > 0) {
        // NETTO-Zielrabatt = MAX aus (a) volumengewichtetem Durchschnitt der individuell
        // garantierten Saetze und (b) dem Tarifsatz fuer das GESAMTE Buendelvolumen.
        // So faellt ein grosses Sammelbuendel nie unter die Stufe, die dem Gesamtvolumen
        // zusteht (z. B. 8 Firmen mit total 1.2 Mio. → mind. 30% netto statt Durchschnitt).
        const weightedAvg = weightedNetSum / ratedChfSum;
        const tierRate = getNetTier(estimatedCHF); // Tarif fuer Gesamtvolumen
        const targetNet = Math.max(tierRate, weightedAvg);
        targetRabatt = Math.round((targetNet + 0.0225) * 10000) / 10000; // GROSS, auf 0.01% gerundet
      } else {
        // kein Request mit festem Satz → Volumen-Tarifstufe als Rückfall
        targetRabatt = isFallback ? FALLBACK_GROSS : (discount as number);
      }

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
        `${g.totalMenge} ${g.einheit} (~${Math.round(estimatedCHF)} CHF) → ${(targetRabatt * 100).toFixed(2)}% target ` +
        `(volumengewichtet aus ${g.requests.length} Commitments${ratedChfSum > 0 ? "" : " → Rückfall Volumenstufe"}), ` +
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
        `(~${s.estimatedCHF} CHF) → ${(s.targetDiscount * 100).toFixed(2)}% target, ${s.requestCount} requests`
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
