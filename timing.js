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

  // Verfügbare Tage bis zu einem Datum (ab heute). Generisch.
  function availableDaysFromToday(dateISO){
    if(!dateISO) return null;
    return Math.floor((midnight(new Date(dateISO)) - midnight(new Date())) / DAY);
  }

  // Gebotsfrist in Tagen je nach verfügbarer Zeit (Minimum 2).
  function bidDeadlineDays(availableDays){
    if(availableDays >= 16) return 7;
    if(availableDays >= 12) return 5;
    if(availableDays >= 9)  return 3;
    return 2;
  }

  // Das Sammelfenster richtet sich nach dem SPÄTESTEN akzeptierten Liefertermin
  // (liefer_zeitraum_bis): bis dahin darf geliefert werden, also bestimmt dieser
  // Termin, wie lange gesammelt werden kann.
  // collection_end = liefer_zeitraum_bis − (bidDeadlineDays + 2 Tage Puffer),
  // jedoch nie später als created_at + 14 Tage (Sammelfenster-Obergrenze).
  function collectionEnd(bisISO, createdAtISO){
    if(!bisISO) return null;
    var avail = availableDaysFromToday(bisISO);
    var bdd = bidDeadlineDays(avail);
    var ce = new Date(bisISO);
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
