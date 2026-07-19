/* SourceOn — global performance & rendering fixes (shared across all pages).
   Loaded synchronously in <head>. Everything here is additive and brick-proof:
   the page is only ever *hidden* by JS that is guaranteed to reveal it again. */
(function () {
  var doc = document;
  var root = doc.documentElement;

  /* ---- 1. FOUC: fade the page in once fonts are ready ------------------- */
  // Hide synchronously (before first paint). Because this only runs when JS is
  // active, a JS failure leaves the page visible rather than blank.
  root.classList.add('js-fade');
  var revealed = false;
  function reveal() {
    if (revealed) return;
    revealed = true;
    root.classList.remove('js-fade');
  }
  // Preferred: reveal when webfonts have settled.
  if (doc.fonts && doc.fonts.ready && typeof doc.fonts.ready.then === 'function') {
    doc.fonts.ready.then(reveal);
  }
  // Fallbacks — any one of these guarantees the page is shown.
  window.addEventListener('load', reveal);
  setTimeout(reveal, 1500);

  /* ---- 3. Clerk auth flicker: reveal [data-auth] elements once ready ---- */
  function markClerkLoaded() {
    if (doc.body) doc.body.classList.add('clerk-loaded');
  }
  function watchClerk() {
    // If Clerk is already up, or there's no Clerk on this page, reveal now.
    if (!window.Clerk) { /* may load later */ }
    if (window.Clerk && window.Clerk.loaded) { markClerkLoaded(); return; }
    var tries = 0;
    var iv = setInterval(function () {
      tries++;
      if (window.Clerk && window.Clerk.loaded) { clearInterval(iv); markClerkLoaded(); }
      else if (tries > 160) { clearInterval(iv); markClerkLoaded(); } // ~8s hard fallback
    }, 50);
  }

  /* ---- Wire up things that need the DOM -------------------------------- */
  function onReady() {
    markClerkLoaded === markClerkLoaded; // noop guard
    watchClerk();
    // If a page has no Clerk script at all, ensure [data-auth] never stays hidden.
    setTimeout(function () { if (!window.Clerk) markClerkLoaded(); }, 300);
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', onReady);
  else onReady();

  /* ---- 10. Helper: dashboards/selectors can guard a Supabase load ------ */
  // Usage: window.soLoadGuard(function(clear){ ...on success call clear()... },
  //                           containerEl)  -> shows an error+retry after 8s.
  window.soLoadGuard = function (containerEl, ms) {
    var done = false;
    var timer = setTimeout(function () {
      if (done || !containerEl) return;
      var box = doc.createElement('div');
      box.className = 'so-load-error';
      box.innerHTML = 'Laden fehlgeschlagen — bitte Seite neu laden.' +
        '<br><button onclick="location.reload()">Neu laden</button>';
      containerEl.appendChild(box);
    }, ms || 8000);
    return function clear() { done = true; clearTimeout(timer); };
  };
})();
