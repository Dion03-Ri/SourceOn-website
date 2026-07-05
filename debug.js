/*
 * SourceOn — gated debug logging.
 * Standardmässig STILL: Besucher sehen keine internen Logs.
 * Für Entwicklung aktivieren:  localStorage.setItem('sourceon_debug','1')  → Seite neu laden.
 * Deaktivieren:                localStorage.removeItem('sourceon_debug')
 *
 * soLog()/soWarn() ersetzen console.log()/console.warn() für internes Debug-Output.
 * Echte Fehler laufen weiterhin über console.error (ohne personenbezogene Daten).
 */
(function () {
  var on = false;
  try { on = localStorage.getItem('sourceon_debug') === '1'; } catch (e) {}
  window.SOURCEON_DEBUG = on;
  window.soLog = function () { if (on) { try { console.log.apply(console, arguments); } catch (e) {} } };
  window.soWarn = function () { if (on) { try { console.warn.apply(console, arguments); } catch (e) {} } };
})();
