/*
 * SourceOn — geteilte Mobile-Navigation.
 * Ergänzt das bestehende #nav-overlay (Burger-Menü) um die Sprachauswahl und
 * die Konto-/Login-Links, damit auf Mobilgeräten alle Desktop-Funktionen
 * erreichbar sind. Auf Seiten ohne #nav-overlay passiert nichts.
 */
(function(){
  function build(){
    var ov = document.getElementById('nav-overlay');
    if(!ov || ov.querySelector('.mnav-extra')) return;

    var extra = document.createElement('div');
    extra.className = 'mnav-extra';

    var div = document.createElement('div');
    div.className = 'mnav-divider';
    extra.appendChild(div);

    // --- Sprachauswahl DE / EN / FR / IT ---
    var cur = window._currentLang || localStorage.getItem('sourceon-lang') || 'de';
    var langRow = document.createElement('div');
    langRow.className = 'mnav-langs';
    [['de','DE'],['en','EN'],['fr','FR'],['it','IT']].forEach(function(l){
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = l[1];
      btn.setAttribute('data-lang', l[0]);
      if(l[0] === cur) btn.className = 'active';
      btn.addEventListener('click', function(){
        langRow.querySelectorAll('button').forEach(function(b){ b.classList.remove('active'); });
        btn.classList.add('active');
        if(typeof setLang === 'function') setLang(l[0]);
        closeOverlay();
      });
      langRow.appendChild(btn);
    });
    extra.appendChild(langRow);

    // --- Konto / Login ---
    var acct = document.createElement('div');
    acct.className = 'mnav-acct';
    function addAction(text, i18nKey, handler){
      var a = document.createElement('a');
      a.href = '#';
      a.textContent = text;
      if(i18nKey) a.setAttribute('data-i18n', i18nKey);
      a.addEventListener('click', function(e){ e.preventDefault(); closeOverlay(); handler(); });
      acct.appendChild(a);
    }
    function addLink(text, i18nKey, href){
      var a = document.createElement('a');
      a.href = href;
      a.textContent = text;
      if(i18nKey) a.setAttribute('data-i18n', i18nKey);
      a.addEventListener('click', function(){ closeOverlay(); });
      acct.appendChild(a);
    }
    if(typeof clerkSignIn === 'function') addAction('Kunden-Login', 'acct_customer_login', function(){ clerkSignIn(); });
    if(typeof clerkCustomerSignUp === 'function') addAction('Als Kunde registrieren', 'acct_customer_register', function(){ clerkCustomerSignUp(); });
    addLink('Lieferant werden', 'nav.supplier', 'lieferant.html');
    if(typeof clerkSignOut === 'function') addAction('Abmelden', 'acct_signout', function(){ clerkSignOut(); });
    extra.appendChild(acct);

    ov.appendChild(extra);

    // Neu eingefügte Texte in aktueller Sprache übersetzen (falls I18N vorhanden)
    if(typeof setLang === 'function'){
      try{ setLang(cur); }catch(e){}
    }
  }

  function closeOverlay(){
    var ov = document.getElementById('nav-overlay');
    if(ov && ov.classList.contains('open') && typeof toggleNav === 'function'){ toggleNav(); }
  }

  if(document.readyState !== 'loading') build();
  else document.addEventListener('DOMContentLoaded', build);
})();
