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

  // Absteigend nach Mindestvolumen (CHF, geschätzter Bestellwert).
  var TIERS = [
    { min: 1000000, net: 0.28, gross: 0.2975 }, // 1M+
    { min: 500000,  net: 0.24, gross: 0.2575 }, // 500k–999k
    { min: 250000,  net: 0.20, gross: 0.22 },   // 250k–499k
    { min: 100000,  net: 0.16, gross: 0.18 },   // 100k–249k
    { min: 50000,   net: 0.13, gross: 0.15 },   // 50k–99k
    { min: 25000,   net: 0.10, gross: 0.12 },   // 25k–49k
    { min: 5000,    net: 0.07, gross: 0.0925 }, // 5k–24k
    { min: 500,     net: 0.05, gross: 0.0725 }, // 500–4'999
  ];
  // Unter CHF 500 (Fallback):
  var FALLBACK = { min: 0, net: 0.05, gross: 0.0725 };

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
    isIndividual: function (v) { return !!tierFor(v).individual; },
    netRate: function (v) { return tierFor(v).net; },
    grossRate: function (v) { return tierFor(v).gross; },
  };
})();
