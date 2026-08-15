/*
 * TEMPORARY PREVIEW GATE — remove this entire script reference from all
 * pages once SourceOn is ready for public launch (company registered,
 * Impressum and Datenschutzerklaerung finalized).
 *
 * This is a simple client-side gate for pre-launch privacy, NOT a real
 * security mechanism. A technically determined visitor could bypass it
 * by reading the page source. It is sufficient to prevent casual visitors
 * from stumbling onto the unfinished site.
 *
 * Password can be changed below (PREVIEW_PASSWORD variable).
 */
(function(){
  var PREVIEW_PASSWORD='2026-View-SourceOn@Previewsite003!!';
  if(localStorage.getItem('sourceon_preview_access')==='granted')return;
  document.documentElement.style.visibility='hidden';
  window.addEventListener('DOMContentLoaded',function(){
    document.body.innerHTML='';
    document.body.style.cssText='margin:0;padding:0;min-height:100vh;background:#0F2238;display:flex;align-items:center;justify-content:center;font-family:Inter,-apple-system,sans-serif';
    document.documentElement.style.visibility='visible';
    var box=document.createElement('div');
    box.style.cssText='text-align:center;max-width:420px;width:100%;padding:24px';
    box.innerHTML='<div style="font-size:28px;font-weight:800;letter-spacing:-.02em;color:#fff;margin-bottom:32px">Source<span style="color:#C8A84B">On</span></div>'
      +'<p style="color:#94A3B8;font-size:.92rem;line-height:1.7;margin-bottom:32px">SourceOn befindet sich im Aufbau.<br>Diese Seite ist noch nicht öffentlich verfügbar.</p>'
      +'<input id="pg-pw" type="password" placeholder="Passwort" style="width:100%;padding:12px 16px;border-radius:10px;border:1.5px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:#fff;font-size:.9rem;font-family:inherit;outline:none;margin-bottom:12px"/>'
      +'<button id="pg-btn" style="width:100%;padding:12px;border-radius:10px;border:none;background:#C8A84B;color:#08111E;font-size:.9rem;font-weight:700;font-family:inherit;cursor:pointer">Zugang</button>'
      +'<div id="pg-err" style="color:#EF4444;font-size:.82rem;margin-top:12px;display:none">Falsches Passwort.</div>';
    document.body.appendChild(box);
    var inp=document.getElementById('pg-pw');
    var btn=document.getElementById('pg-btn');
    var err=document.getElementById('pg-err');
    function tryAccess(){
      if(inp.value===PREVIEW_PASSWORD){
        localStorage.setItem('sourceon_preview_access','granted');
        window.location.reload();
      }else{
        err.style.display='block';
        inp.value='';
      }
    }
    btn.addEventListener('click',tryAccess);
    inp.addEventListener('keydown',function(e){if(e.key==='Enter')tryAccess();});
    inp.focus();
  });
})();
