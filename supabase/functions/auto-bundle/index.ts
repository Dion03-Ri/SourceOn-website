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
    const receivedSecret = req.headers.get("x-ai-secret");
    // TEMP-DIAGNOSE (keine Secret-Werte, nur Vorhandensein/Laenge/Match) — nach dem Fix wieder entfernen.
    console.log("[auth-debug] envSet=" + (triggerSecret ? ("yes(len=" + triggerSecret.length + ")") : "NO") +
      " recvSet=" + (receivedSecret ? ("yes(len=" + receivedSecret.length + ")") : "NO") +
      " match=" + (triggerSecret != null && triggerSecret === receivedSecret));
    if (!triggerSecret || receivedSecret !== triggerSecret) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, supabaseKey);

    const now = new Date();
    const nowMs = now.getTime();
    const minCollEndMs = nowMs + 5 * DAY_MS; // Mindest-Sammelfenster: 5 Tage

    // Timing fuer eine Menge von Requests: frueheste berechnete collection_end,
    // Dringlichkeit (fruehester Liefertermin <= 12 Tage) und bid_deadline-Tage.
    function groupTiming(reqs: Array<{ liefer_zeitraum_bis: string; liefer_zeitraum_von: string; created_at?: string | null; fallback_deadline?: string | null }>) {
      let calc: Date | null = null;
      let urgent = false;
      let urgentBidDays = 7;
      let earliestBis: string | null = null;
      for (const r of reqs) {
        const ce = collectionEnd(r.liefer_zeitraum_bis, r.created_at ?? r.fallback_deadline ?? null);
        if (!calc || ce.getTime() < calc.getTime()) calc = ce;
        if (r.liefer_zeitraum_von && availableDaysFromToday(r.liefer_zeitraum_von) <= 12) urgent = true;
        const bdd = bidDeadlineDays(availableDaysFromToday(r.liefer_zeitraum_bis));
        if (earliestBis === null || r.liefer_zeitraum_bis < earliestBis) { earliestBis = r.liefer_zeitraum_bis; urgentBidDays = bdd; }
      }
      return { calc: calc ?? now, urgent, urgentBidDays };
    }

    // 1. Offene, noch nicht gebuendelte Requests
    const { data: openRequests, error: fetchErr } = await sb
      .from("material_requests")
      .select("id, sourceon_id, menge, einheit, liefer_zone, liefer_zeitraum_von, liefer_zeitraum_bis, fallback_deadline, committed_min_rabatt, created_at")
      .eq("status", "offen")
      .is("bundle_id", null);
    if (fetchErr) {
      return Response.json({ error: "Failed to fetch requests", detail: fetchErr.message }, { status: 500 });
    }

    // 2. Bestehende 'sammelt'-Buendel (zum Beitreten)
    const { data: sammeltRows } = await sb
      .from("bundles")
      .select("id, sourceon_id, liefer_zone, liefer_zeitraum_von, liefer_zeitraum_bis, bid_deadline, gesamtvolumen")
      .eq("status", "sammelt");
    const sammeltBundles = (sammeltRows ?? []) as Array<Record<string, any>>;

    if ((!openRequests || openRequests.length === 0) && sammeltBundles.length === 0) {
      return Response.json({ message: "Nothing to do", bundlesPublished: 0 });
    }

    // Materialkatalog (einheit + richtpreis_chf)
    const { data: catalog } = await sb.from("material_catalog").select("sourceon_id, einheit, richtpreis_chf");
    const catalogMap: Record<string, { einheit: string; richtpreis: number | null }> = {};
    if (catalog) for (const c of catalog) catalogMap[c.sourceon_id] = { einheit: c.einheit, richtpreis: c.richtpreis_chf };

    const summary: Array<Record<string, any>> = [];
    const skipped: Array<Record<string, any>> = [];
    const bundlesToProcess = new Set<string>();

    // 3. Jeden offenen Request zuordnen: bestehendem 'sammelt'-Buendel beitreten,
    //    sonst in eine neue Gruppe (nach sourceon_id + liefer_zone + Datumsueberlappung).
    const newGroups: RequestGroup[] = [];
    const joinMap: Record<string, MaterialRequest[]> = {};
    for (const r of (openRequests ?? []) as MaterialRequest[]) {
      if (!r.menge || !r.sourceon_id || !r.liefer_zone || !r.liefer_zeitraum_von || !r.liefer_zeitraum_bis) continue;
      let joined = false;
      for (const bnd of sammeltBundles) {
        if (bnd.sourceon_id === r.sourceon_id && bnd.liefer_zone === r.liefer_zone &&
            bnd.liefer_zeitraum_von && bnd.liefer_zeitraum_bis &&
            datesOverlap(bnd.liefer_zeitraum_von, bnd.liefer_zeitraum_bis, r.liefer_zeitraum_von, r.liefer_zeitraum_bis)) {
          (joinMap[bnd.id] ??= []).push(r);
          if (r.liefer_zeitraum_von < bnd.liefer_zeitraum_von) bnd.liefer_zeitraum_von = r.liefer_zeitraum_von;
          if (r.liefer_zeitraum_bis > bnd.liefer_zeitraum_bis) bnd.liefer_zeitraum_bis = r.liefer_zeitraum_bis;
          joined = true;
          break;
        }
      }
      if (joined) continue;
      let placed = false;
      for (const g of newGroups) {
        if (g.sourceon_id === r.sourceon_id && g.liefer_zone === r.liefer_zone &&
            datesOverlap(g.liefer_zeitraum_von, g.liefer_zeitraum_bis, r.liefer_zeitraum_von, r.liefer_zeitraum_bis)) {
          g.requests.push(r); g.totalMenge += Number(r.menge);
          if (r.liefer_zeitraum_von < g.liefer_zeitraum_von) g.liefer_zeitraum_von = r.liefer_zeitraum_von;
          if (r.liefer_zeitraum_bis > g.liefer_zeitraum_bis) g.liefer_zeitraum_bis = r.liefer_zeitraum_bis;
          placed = true; break;
        }
      }
      if (!placed) newGroups.push({
        sourceon_id: r.sourceon_id, liefer_zone: r.liefer_zone,
        liefer_zeitraum_von: r.liefer_zeitraum_von, liefer_zeitraum_bis: r.liefer_zeitraum_bis,
        totalMenge: Number(r.menge), einheit: r.einheit || catalogMap[r.sourceon_id]?.einheit || "Stk",
        requests: [r],
      });
    }

    // 4. Beitritte in bestehende 'sammelt'-Buendel anwenden (CHANGE 3 + 4)
    for (const bnd of sammeltBundles) {
      bundlesToProcess.add(bnd.id); // immer auf Publish pruefen
      const joins = joinMap[bnd.id];
      if (!joins || !joins.length) continue;
      const ids = joins.map((r) => r.id);
      await sb.from("material_requests").update({ bundle_id: bnd.id }).in("id", ids);
      const addVol = joins.reduce((sum: number, r: MaterialRequest) => sum + Number(r.menge), 0);
      const newVol = Number(bnd.gesamtvolumen || 0) + addVol;
      // CHANGE 4: collection_end = max(bestehend, neue Request-collection_end, now + 5 Tage)
      const jt = groupTiming(joins);
      const existingCE = bnd.bid_deadline ? new Date(bnd.bid_deadline).getTime() : 0;
      const collEndMs = Math.max(existingCE, jt.calc.getTime(), minCollEndMs);
      await sb.from("bundles").update({
        gesamtvolumen: newVol,
        liefer_zeitraum_von: bnd.liefer_zeitraum_von,
        liefer_zeitraum_bis: bnd.liefer_zeitraum_bis,
        bid_deadline: new Date(collEndMs).toISOString(),
      }).eq("id", bnd.id);
      console.log(`[auto-bundle] ${joins.length} request(s) joined sammelt bundle ${bnd.id}; collection_end=${new Date(collEndMs).toISOString().slice(0, 10)}`);
    }

    // 5. Neue 'sammelt'-Buendel fuer unzugeordnete Gruppen (CHANGE 2 + 1)
    for (const g of newGroups) {
      const richtpreis = catalogMap[g.sourceon_id]?.richtpreis ?? null;
      if (richtpreis === null) {
        skipped.push({ sourceon_id: g.sourceon_id, liefer_zone: g.liefer_zone, estimatedCHF: 0, reason: `No richtpreis_chf for ${g.sourceon_id}` });
        continue;
      }
      const t = groupTiming(g.requests);
      // CHANGE 1: collection_end = urgent ? now : max(calculatedEnd, now + 5 Tage)
      const collEndMs = t.urgent ? nowMs : Math.max(t.calc.getTime(), minCollEndMs);
      const { data: bundle, error: insertErr } = await sb.from("bundles").insert({
        sourceon_id: g.sourceon_id, liefer_zone: g.liefer_zone,
        liefer_zeitraum_von: g.liefer_zeitraum_von, liefer_zeitraum_bis: g.liefer_zeitraum_bis,
        gesamtvolumen: g.totalMenge, einheit: g.einheit,
        status: "sammelt", bundle_type: "single_material",
        bid_deadline: new Date(collEndMs).toISOString(),
      }).select("id").single();
      if (insertErr || !bundle) { console.error(`Failed to create sammelt bundle ${g.sourceon_id}/${g.liefer_zone}:`, insertErr); continue; }
      await sb.from("material_requests").update({ bundle_id: bundle.id }).in("id", g.requests.map((r) => r.id));
      bundlesToProcess.add(bundle.id);
      console.log(`[auto-bundle] CREATED sammelt bundle ${bundle.id} (${g.sourceon_id}/${g.liefer_zone}, ${g.requests.length} req) collection_end=${new Date(collEndMs).toISOString().slice(0, 10)}${t.urgent ? " URGENT" : ""}`);
    }

    // 6. Publish-Pruefung fuer alle 'sammelt'-Buendel: urgent ODER collection_end erreicht → 'ausgeschrieben'
    for (const bid of bundlesToProcess) {
      const { data: members } = await sb.from("material_requests")
        .select("id, menge, liefer_zeitraum_von, liefer_zeitraum_bis, committed_min_rabatt, created_at, fallback_deadline, sourceon_id, liefer_zone")
        .eq("bundle_id", bid);
      if (!members || !members.length) continue;
      const { data: bRow } = await sb.from("bundles").select("bid_deadline, status").eq("id", bid).single();
      if (!bRow || bRow.status !== "sammelt") continue;
      const sid = members[0].sourceon_id as string;
      const zone = members[0].liefer_zone as string;
      const t = groupTiming(members as any);
      const storedCE = bRow.bid_deadline ? new Date(bRow.bid_deadline).getTime() : nowMs;
      const shouldPublish = t.urgent || storedCE <= nowMs;
      if (!shouldPublish) {
        skipped.push({ sourceon_id: sid, liefer_zone: zone, estimatedCHF: 0, reason: `Collecting until ${new Date(storedCE).toISOString().slice(0, 10)}` });
        continue;
      }
      const richtpreis = catalogMap[sid]?.richtpreis ?? null;
      if (richtpreis === null) { skipped.push({ sourceon_id: sid, liefer_zone: zone, estimatedCHF: 0, reason: `No richtpreis_chf for ${sid}` }); continue; }
      const totalMenge = members.reduce((sum: number, r: any) => sum + Number(r.menge), 0);
      const estimatedCHF = totalMenge * richtpreis;
      const discount = getGrossTarget(estimatedCHF);
      const isFallback = discount === null;
      let weightedNetSum = 0, ratedChfSum = 0;
      for (const r of members) {
        const c = r.committed_min_rabatt; if (c == null) continue;
        const rate = Number(c); if (isNaN(rate)) continue;
        const chf = Number(r.menge) * richtpreis; weightedNetSum += chf * rate; ratedChfSum += chf;
      }
      let targetRabatt: number;
      if (ratedChfSum > 0) {
        const weightedAvg = weightedNetSum / ratedChfSum;
        const tierRate = getNetTier(estimatedCHF);
        targetRabatt = Math.round((Math.max(tierRate, weightedAvg) + 0.0225) * 10000) / 10000;
      } else {
        targetRabatt = isFallback ? FALLBACK_GROSS : (discount as number);
      }
      const bidDeadline = new Date(nowMs + t.urgentBidDays * DAY_MS);
      const { error: pubErr } = await sb.from("bundles").update({
        status: "ausgeschrieben",
        ziel_mindestrabatt: targetRabatt,
        gesamtvolumen: totalMenge,
        bid_deadline: bidDeadline.toISOString(),
        is_fallback_bundle: isFallback,
      }).eq("id", bid);
      if (pubErr) { console.error(`Failed to publish bundle ${bid}:`, pubErr); continue; }
      await sb.from("material_requests").update({ status: "gebuendelt" }).eq("bundle_id", bid);
      console.log(`[auto-bundle] PUBLISHED bundle ${bid} (${sid}/${zone}) — ${totalMenge} (~${Math.round(estimatedCHF)} CHF) → ${(targetRabatt * 100).toFixed(2)}% target, bidDeadline=+${t.urgentBidDays}d${t.urgent ? " (urgent)" : ""}`);
      summary.push({ sourceon_id: sid, liefer_zone: zone, totalMenge, einheit: catalogMap[sid]?.einheit ?? "", estimatedCHF: Math.round(estimatedCHF), targetDiscount: targetRabatt, requestCount: members.length });
    }

    console.log(`[auto-bundle] Published ${summary.length} bundle(s), still collecting/skipped ${skipped.length}`);
    return Response.json({
      bundlesPublished: summary.length,
      skipped: skipped.length,
      bundles: summary,
      skippedDetail: skipped,
      openRequestsProcessed: (openRequests ?? []).length,
    });
  } catch (err) {
    console.error("[auto-bundle] Unexpected error:", err);
    return Response.json({ error: "Internal error", detail: String(err) }, { status: 500 });
  }
});
