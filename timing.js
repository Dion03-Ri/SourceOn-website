/*
 * SourceOn — geteilte Timing-Formeln für Sammelfenster & Gebotsfrist.
 *
 * ⚠️ WICHTIG: Diese Formeln (bidDeadlineDays & collectionEnd) MÜSSEN synchron
 * bleiben mit supabase/functions/auto-bundle/index.ts. Jede Änderung hier muss
 * dort ebenfalls nachgezogen werden (und umgekehrt).
 *
 * Genutzt von kontakt.html (Tempo-Indikator) und kundendashboard.html
 * (Anzeige "Ausschreibung spätestens am …").
 */
(function(){
  var DAY = 86400000;
  function midnight(d){ var x = new Date(d); x.setHours(0,0,0,0); return x; }

  // Verfügbare Tage bis zum frühesten Lieferdatum (ab heute).
  function availableDaysFromToday(vonISO){
    if(!vonISO) return null;
    return Math.floor((midnight(new Date(vonISO)) - midnight(new Date())) / DAY);
  }

  // Gebotsfrist in Tagen je nach verfügbarer Zeit (Minimum 2).
  function bidDeadlineDays(availableDays){
    if(availableDays >= 16) return 7;
    if(availableDays >= 12) return 5;
    if(availableDays >= 9)  return 3;
    return 2;
  }

  // collection_end = liefer_zeitraum_von − (bidDeadlineDays + 2 Tage Puffer),
  // jedoch nie später als created_at + 14 Tage (bestehende Fallback-Obergrenze).
  function collectionEnd(vonISO, createdAtISO){
    if(!vonISO) return null;
    var avail = availableDaysFromToday(vonISO);
    var bdd = bidDeadlineDays(avail);
    var ce = new Date(vonISO);
    ce.setDate(ce.getDate() - (bdd + 2));
    if(createdAtISO){
      var cap = new Date(createdAtISO);
      cap.setDate(cap.getDate() + 14);
      if(ce > cap) ce = cap;
    }
    return ce;
  }

  window.SO_TIMING = {
    MIN_LEAD_DAYS: 5,
    availableDaysFromToday: availableDaysFromToday,
    bidDeadlineDays: bidDeadlineDays,
    collectionEnd: collectionEnd
  };
})();
