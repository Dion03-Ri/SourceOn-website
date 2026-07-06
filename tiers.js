/*
 * SourceOn — Rabattstufen (Single Source of Truth).
 *
 * Zwei-Spalten-Modell:
 *   net   = garantierter NETTO-Mindestrabatt für den Kunden (was tatsächlich bei ihm ankommt)
 *   gross = im Bündel an Lieferanten ausgeschriebener BRUTTO-Mindestrabatt (ziel_mindestrabatt)
 *
 * SourceOn-Erfolgsprovision = 2.25% des Bestellwerts (= baseline × (1 − gross)),
 * dem Lieferanten in Rechnung gestellt. Der Kunde erhält nie weniger als seinen Netto-Wert.
 *
 * Gross-Formel (zum Regenerieren, falls Provision oder Netto-Stufen sich ändern):
 *   gross = ceil_to_0.25%( (net + 0.0225) / 1.0225 )
 * (auf das nächste 0.25% aufgerundet, damit die Netto-Garantie zuverlässig erreicht wird).
 *
 * ⚠️ MUSS synchron bleiben mit SUPPLIER_TIERS in
 *    supabase/functions/auto-bundle/index.ts — jede Änderung dort ebenfalls nachziehen.
 *
 * Kundenanzeigen (Formular, Dashboard, Kalkulator) zeigen IMMER net.
 * Bündel/Edge Function/Lieferantenanforderung nutzen gross.
 */
(function () {
  var COMMISSION_RATE = 0.0225;

  // Absteigend nach Mindestvolumen (CHF, geschätzter Auftragswert).
  var TIERS = [
    { min: 6000000, net: 0.28, gross: 0.2975 }, // über 6M
    { min: 3000000, net: 0.24, gross: 0.2575 }, // 3M–6M
    { min: 1200000, net: 0.20, gross: 0.22 },   // 1.2M–3M
    { min: 600000,  net: 0.16, gross: 0.18 },   // 600k–1.2M
    { min: 300000,  net: 0.13, gross: 0.15 },   // 300k–600k
    { min: 150000,  net: 0.10, gross: 0.12 },   // 150k–300k
    { min: 50000,   net: 0.07, gross: 0.0925 }, // 50k–150k
  ];
  // Unter 50k (Fallback-Bündel):
  var FALLBACK = { min: 0, net: 0.07, gross: 0.0925 };

  function tierFor(valueCHF) {
    for (var i = 0; i < TIERS.length; i++) {
      if (valueCHF >= TIERS[i].min) return TIERS[i];
    }
    return FALLBACK;
  }

  window.SO_TIERS = {
    COMMISSION_RATE: COMMISSION_RATE,
    TIERS: TIERS,
    FALLBACK: FALLBACK,
    tierFor: tierFor,
    netRate: function (v) { return tierFor(v).net; },
    grossRate: function (v) { return tierFor(v).gross; },
  };
})();
