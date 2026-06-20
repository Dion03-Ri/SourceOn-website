#!/usr/bin/env python3
"""Split index.html into multi-page architecture."""
import re

html = open('index.html').read()
lines = html.split('\n')

# Extract key blocks by line ranges (0-indexed in the lines array)
# CSS: lines 10 (opening <style>) through 668 (closing </style>)
# We'll grab from <!DOCTYPE> through </style></head> as the "head" template

# Find indices
def find_line(pattern, start=0):
    for i, l in enumerate(lines[start:], start):
        if pattern in l:
            return i
    return -1

# HEAD: lines 0-670 (through </head><body>)
head_end = find_line('</style>')
head_block = '\n'.join(lines[0:head_end+1])

# NAV: 672-698
nav_start = find_line('<!-- NAV -->')
nav_lines_end = find_line('</div>', find_line('</nav>'))
# Actually let's grab from <!-- NAV --> through the nav-overlay closing </div>
nav_overlay_end = find_line('</div>', find_line('Materialbedarf melden', find_line('nav-overlay')))
# Let me just find the sections by comments
def extract_between_comments(start_comment, end_comment):
    s = find_line(start_comment)
    e = find_line(end_comment, s+1)
    return '\n'.join(lines[s:e])

# Let me find all section comment markers
comments = []
for i, l in enumerate(lines):
    if l.strip().startswith('<!--') and '-->' in l and len(l.strip()) < 80:
        comments.append((i, l.strip()))

# Build the pages using a different approach: identify each HTML section by its comment marker
# and extract the content between them.

# First, let's identify the line ranges for each section
sections = {}

def lines_between(start_line, end_line):
    return '\n'.join(lines[start_line:end_line])

# HERO section
hero_start = find_line('<!-- HERO -->')
word_reveal_start = find_line('<!-- WORD REVEAL -->')
process_start = find_line('<!-- PROCESS -->')
suppliers_start = find_line('<!-- SUPPLIERS MARQUEE -->')
forwhom_start = find_line('<!-- FOR WHOM -->')
calculator_start = find_line('<!-- CALCULATOR -->')
bignum_start = find_line('<!-- BIG NUMBER -->')
why_start = find_line('<!-- WHY SourceOn -->')
mat_norms_start = find_line('<!-- MATERIALS & NORMS -->')
materials_start = find_line('<!-- MATERIALS -->')
comparison_start = find_line('<!-- COMPARISON -->')
zahlen_start = find_line('<!-- ZAHLEN & FAKTEN -->')
tech_start = find_line('<!-- TECHNOLOGIE -->')
supplier_apply_start = find_line('<!-- SUPPLIER APPLICATION -->')
bundling_start = find_line('<!-- BUNDLING -->')
about_start = find_line('id="about"')
# Walk back to find the <section tag for this id
if about_start != -1:
    for i in range(about_start, 0, -1):
        if '<section' in lines[i]:
            about_start = i
            break
faq_start = find_line('<!-- FAQ -->')
cta_start = find_line('<!-- CTA BANNER -->')
contact_start = find_line('<!-- CONTACT / UNIFIED FORM -->')
footer_start = find_line('<!-- FOOTER -->')

# Find the bundling section
bundling_line = find_line('<!-- BUNDLING')
if bundling_line == -1:
    bundling_line = find_line('id="bundling"')
    # find the section start before it
    for i in range(bundling_line, 0, -1):
        if '<section' in lines[i]:
            bundling_line = i
            break

# Three.js script starts right after bundling section
threejs_script_start = find_line('three.min.js')

# Find all script blocks
second_script_start = find_line('<script>', threejs_script_start + 2)

# Chat widget HTML
chat_start = find_line('<!-- CHAT WIDGET -->', second_script_start)

# Footer end
footer_end_line = find_line('</footer>')

# Extract the CSS (everything in <style>)
style_start = find_line('<style>')
style_end = find_line('</style>')
css_block = '\n'.join(lines[style_start:style_end+1])

# Extract head without body-specific stuff
head_template = '\n'.join(lines[0:style_end+1])

# Nav block (nav + overlay + bento modal)
nav_end = find_line('</div>', find_line('</nav>'))
# Actually the nav section includes the overlay div too
overlay_end = find_line('Materialbedarf melden', find_line('nav-overlay'))
# Find closing button tag
for i in range(overlay_end, overlay_end+5):
    if '</div>' in lines[i]:
        overlay_end = i
        break

bento_modal_start = find_line('<!-- BENTO DETAIL MODAL -->')
bento_modal_end = find_line('</div>', find_line('</div>', bento_modal_start) + 1)

# Get nav HTML
nav_html = '\n'.join(lines[nav_start:bento_modal_end+1])

# Footer HTML
footer_html = '\n'.join(lines[footer_start:footer_end_line+1])

# Chat widget HTML (button + window)
chat_html = '\n'.join(lines[chat_start:])
# Remove </body></html> from chat_html and add separately
chat_html = chat_html.replace('</body>\n</html>', '').replace('</body>', '').replace('</html>', '').strip()

# Second script block (contains all JS logic)
# It starts at the line with <script> after three.js + supabase CDN includes
script_block_start = find_line('<script>', threejs_script_start + 3)
script_block_end = find_line('</script>', script_block_start)
main_script = '\n'.join(lines[script_block_start:script_block_end+1])

# ---- Now build the updated nav for multi-page ----
nav_multipage = nav_html

# Update nav links for multi-page
nav_multipage = nav_multipage.replace('href="#process"', 'href="prozess.html"')
nav_multipage = nav_multipage.replace('href="#forwhom"', 'href="fuer-wen.html"')
nav_multipage = nav_multipage.replace('href="#supplier-apply"', 'href="lieferant.html"')
nav_multipage = nav_multipage.replace('href="#about"', 'href="ueber-uns.html"')
nav_multipage = nav_multipage.replace('href="#contact"', 'href="kontakt.html"')
nav_multipage = nav_multipage.replace("smoothScrollToEl(document.getElementById('contact'))", "window.location.href='kontakt.html'")
# Also make sure there's a link to materialien
nav_multipage = nav_multipage.replace(
    '<li><a href="prozess.html">Wie es funktioniert</a></li>',
    '<li><a href="prozess.html">Wie es funktioniert</a></li>\n      <li><a href="materialien.html">Materialien</a></li>'
)

# Footer for multi-page
footer_multipage = footer_html
footer_multipage = footer_multipage.replace('href="#process"', 'href="prozess.html"')
footer_multipage = footer_multipage.replace('href="#forwhom"', 'href="fuer-wen.html"')
footer_multipage = footer_multipage.replace('href="#supplier-apply"', 'href="lieferant.html"')
footer_multipage = footer_multipage.replace('href="#calculator"', 'href="index.html#calculator"')
footer_multipage = footer_multipage.replace('href="#materials"', 'href="materialien.html"')
footer_multipage = footer_multipage.replace('href="#about"', 'href="ueber-uns.html"')
footer_multipage = footer_multipage.replace('href="#contact"', 'href="kontakt.html"')

# ---- Extract section HTML blocks ----
# Hero (including word reveal)
hero_html = '\n'.join(lines[hero_start:word_reveal_start])
wordreveal_html = '\n'.join(lines[word_reveal_start:process_start])

# Process section
process_html = '\n'.join(lines[process_start:suppliers_start])

# Suppliers marquee
suppliers_html = '\n'.join(lines[suppliers_start:forwhom_start])

# For whom
forwhom_html = '\n'.join(lines[forwhom_start:calculator_start])

# Calculator
calculator_html = '\n'.join(lines[calculator_start:bignum_start])

# Big number
bignum_html = '\n'.join(lines[bignum_start:why_start])

# Why SourceOn
why_html = '\n'.join(lines[why_start:mat_norms_start])

# Mat norms
matnorms_html = '\n'.join(lines[mat_norms_start:materials_start])

# Materials bento grid
materials_html = '\n'.join(lines[materials_start:comparison_start])

# Comparison
comparison_html = '\n'.join(lines[comparison_start:zahlen_start])

# Zahlen
zahlen_html = '\n'.join(lines[zahlen_start:tech_start])

# Technologie (chip visual)
tech_html = '\n'.join(lines[tech_start:supplier_apply_start])

# Supplier application
# Find where bundling section starts
bundling_comment = find_line('<!-- BUNDLING')
if bundling_comment == -1:
    # Look for the bundling section by its id
    for i in range(supplier_apply_start, len(lines)):
        if 'id="bundling"' in lines[i] or '<!-- BUNDLING' in lines[i]:
            bundling_comment = i
            # Go back to find section start
            for j in range(i, max(i-5, 0), -1):
                if '<section' in lines[j] or '<!--' in lines[j]:
                    bundling_comment = j
                    break
            break
supplier_html = '\n'.join(lines[supplier_apply_start:bundling_comment])

# About section
about_html = '\n'.join(lines[about_start:faq_start])

# FAQ
faq_html = '\n'.join(lines[faq_start:cta_start])

# CTA Banner
cta_html = '\n'.join(lines[cta_start:contact_start])

# Contact form
contact_html = '\n'.join(lines[contact_start:footer_start])

# Bundling (3D hologram) section + Three.js
bundling_section_html = '\n'.join(lines[bundling_comment:threejs_script_start])
threejs_include = lines[threejs_script_start]
supabase_include = lines[threejs_script_start + 1] if 'supabase' in lines[threejs_script_start + 1] else ''
# The Three.js animation script (the IIFE after the CDN includes)
threejs_script_start_line = find_line('<script>', threejs_script_start + 1)
if 'supabase' in lines[threejs_script_start + 1]:
    threejs_script_start_line = find_line('<script>', threejs_script_start + 2)
threejs_script_end_line = find_line('</script>', threejs_script_start_line)
threejs_script = '\n'.join(lines[threejs_script_start_line:threejs_script_end_line+1])

# Main JS script (second <script> block with all the app logic)
main_script_start = find_line('<script>', threejs_script_end_line + 1)
main_script_end = find_line('</script>', main_script_start)
main_js = '\n'.join(lines[main_script_start:main_script_end+1])

print(f"Hero: {hero_start}")
print(f"Word reveal: {word_reveal_start}")
print(f"Process: {process_start}")
print(f"Suppliers: {suppliers_start}")
print(f"For whom: {forwhom_start}")
print(f"Calculator: {calculator_start}")
print(f"Bignum: {bignum_start}")
print(f"Why: {why_start}")
print(f"Mat norms: {mat_norms_start}")
print(f"Materials: {materials_start}")
print(f"Comparison: {comparison_start}")
print(f"Zahlen: {zahlen_start}")
print(f"Tech: {tech_start}")
print(f"Supplier: {supplier_apply_start}")
print(f"Bundling: {bundling_comment}")
print(f"About: {about_start}")
print(f"FAQ: {faq_start}")
print(f"CTA: {cta_start}")
print(f"Contact: {contact_start}")
print(f"Footer: {footer_start}")
print(f"Chat: {chat_start}")
print(f"Three.js script: {threejs_script_start_line}-{threejs_script_end_line}")
print(f"Main JS: {main_script_start}-{main_script_end}")

# ---- NAV CARDS for homepage ----
nav_cards_html = """
<!-- EXPLORE -->
<section class="section" style="background:var(--dark);padding:100px 0">
  <div class="container">
    <div class="text-center reveal" style="margin-bottom:48px">
      <div class="label label-dark">Entdecken</div>
      <h2 class="h2" style="color:#fff">Alles über SourceOn.</h2>
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:20px" class="reveal">
      <a href="prozess.html" style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:var(--r-lg);padding:32px 28px;text-decoration:none;transition:border-color .3s,background .3s,transform .3s">
        <div style="width:44px;height:44px;border-radius:50%;background:rgba(232,160,32,.1);border:1px solid rgba(232,160,32,.25);display:flex;align-items:center;justify-content:center;margin-bottom:20px;color:var(--gold)"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg></div>
        <h3 style="font-size:1.05rem;font-weight:700;color:#fff;margin-bottom:8px">Wie es funktioniert</h3>
        <p style="font-size:.84rem;color:rgba(255,255,255,.5);line-height:1.6;margin-bottom:16px">Vier Schritte vom Bedarf bis zur Lieferung — und warum es sich lohnt.</p>
        <span style="font-size:.82rem;color:var(--gold);font-weight:600">Mehr erfahren →</span>
      </a>
      <a href="materialien.html" style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:var(--r-lg);padding:32px 28px;text-decoration:none;transition:border-color .3s,background .3s,transform .3s">
        <div style="width:44px;height:44px;border-radius:50%;background:rgba(232,160,32,.1);border:1px solid rgba(232,160,32,.25);display:flex;align-items:center;justify-content:center;margin-bottom:20px;color:var(--gold)"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6l9-3 9 3v12l-9 3-9-3V6z"/></svg></div>
        <h3 style="font-size:1.05rem;font-weight:700;color:#fff;margin-bottom:8px">Materialien &amp; Lieferanten</h3>
        <p style="font-size:.84rem;color:rgba(255,255,255,.5);line-height:1.6;margin-bottom:16px">50+ Baustoffe, geprüfte Partnerlieferanten in der ganzen Schweiz.</p>
        <span style="font-size:.82rem;color:var(--gold);font-weight:600">Mehr erfahren →</span>
      </a>
      <a href="fuer-wen.html" style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:var(--r-lg);padding:32px 28px;text-decoration:none;transition:border-color .3s,background .3s,transform .3s">
        <div style="width:44px;height:44px;border-radius:50%;background:rgba(232,160,32,.1);border:1px solid rgba(232,160,32,.25);display:flex;align-items:center;justify-content:center;margin-bottom:20px;color:var(--gold)"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg></div>
        <h3 style="font-size:1.05rem;font-weight:700;color:#fff;margin-bottom:8px">Für wen</h3>
        <p style="font-size:.84rem;color:rgba(255,255,255,.5);line-height:1.6;margin-bottom:16px">Bauunternehmen, Handwerker, Investoren und Architekten.</p>
        <span style="font-size:.82rem;color:var(--gold);font-weight:600">Mehr erfahren →</span>
      </a>
      <a href="lieferant.html" style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:var(--r-lg);padding:32px 28px;text-decoration:none;transition:border-color .3s,background .3s,transform .3s">
        <div style="width:44px;height:44px;border-radius:50%;background:rgba(232,160,32,.1);border:1px solid rgba(232,160,32,.25);display:flex;align-items:center;justify-content:center;margin-bottom:20px;color:var(--gold)"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></div>
        <h3 style="font-size:1.05rem;font-weight:700;color:#fff;margin-bottom:8px">Lieferant werden</h3>
        <p style="font-size:.84rem;color:rgba(255,255,255,.5);line-height:1.6;margin-bottom:16px">Verifizierter SourceOn-Partner werden und Zugang zu gebündelten Aufträgen erhalten.</p>
        <span style="font-size:.82rem;color:var(--gold);font-weight:600">Jetzt bewerben →</span>
      </a>
    </div>
  </div>
</section>
"""

# Add hover effect via inline style won't work well, let's add a small CSS addition
nav_cards_css = """
/* NAV CARDS */
.nav-card-grid a:hover{border-color:rgba(232,160,32,.3)!important;background:rgba(255,255,255,.06)!important;transform:translateY(-4px)}
@media(max-width:900px){.nav-card-grid{grid-template-columns:1fr 1fr!important}}
@media(max-width:640px){.nav-card-grid{grid-template-columns:1fr!important}}
"""
# Fix: add class to the grid div
nav_cards_html = nav_cards_html.replace(
    'style="display:grid;grid-template-columns:repeat(4,1fr);gap:20px" class="reveal"',
    'class="nav-card-grid reveal" style="display:grid;grid-template-columns:repeat(4,1fr);gap:20px"'
)

# ---- SUBPAGE TEMPLATE ----
def make_subpage(title, body_sections, needs_supabase=False, needs_threejs=False, extra_js=''):
    """Build a complete subpage HTML string."""
    # Start with head, replacing title
    page_head = head_template.replace(
        '<title>SourceOn — Du zahlst erst, wenn wir dir sparen.</title>',
        f'<title>{title} — SourceOn</title>'
    )
    # Add nav cards CSS before </style>
    page_head = page_head.replace('</style>', nav_cards_css + '</style>')

    page = page_head + '\n</head>\n<body>\n'
    page += nav_multipage + '\n\n'
    page += '\n\n'.join(body_sections) + '\n\n'
    page += footer_multipage + '\n\n'

    # Scripts
    if needs_threejs:
        page += threejs_include + '\n'
    if needs_supabase:
        page += '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>\n'

    # Common JS (scroll reveal, nav, FAQ, counters etc)
    page += """<script>
// SMOOTH ANCHOR SCROLL
function easeOutExpo(t){return t===1?1:1-Math.pow(2,-10*t);}
function smoothScrollToEl(target,duration){
  const startY=window.scrollY;
  const endY=target.getBoundingClientRect().top+startY;
  const dist=endY-startY;
  duration=duration||Math.min(900,Math.max(420,Math.abs(dist)*.5));
  const t0=performance.now();
  function step(now){
    const p=Math.min(1,(now-t0)/duration);
    window.scrollTo(0,startY+dist*easeOutExpo(p));
    if(p<1)requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}
document.querySelectorAll('a[href^="#"]').forEach(a=>{
  a.addEventListener('click',function(e){
    const id=a.getAttribute('href');
    if(id.length<2)return;
    const target=document.querySelector(id);
    if(!target)return;
    e.preventDefault();
    smoothScrollToEl(target);
  });
});

// NAV
let lastScrollY=window.scrollY;
window.addEventListener('scroll',()=>{
  const nav=document.getElementById('nav');
  const y=window.scrollY;
  nav.classList.toggle('scrolled',y>40);
  if(y>140&&y>lastScrollY){nav.classList.add('nav-hidden')}
  else if(y<lastScrollY){nav.classList.remove('nav-hidden')}
  lastScrollY=y;
});
function toggleNav(){
  const o=document.getElementById('nav-overlay');
  o.classList.toggle('open');
  document.body.style.overflow=o.classList.contains('open')?'hidden':'';
}

// SCROLL REVEAL
const ro=new IntersectionObserver(entries=>{
  entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('visible');ro.unobserve(e.target);}});
},{threshold:0.1});
document.querySelectorAll('.reveal,.slide-left').forEach(el=>ro.observe(el));

// COUNTERS
function countEl(el,dur){
  dur=dur||1200;
  const t0=performance.now();
  if(el.dataset.count!==undefined){
    const target=parseFloat(el.dataset.count),suffix=el.dataset.suffix||'',dec=parseInt(el.dataset.dec||0);
    const iv=setInterval(()=>{
      const p=Math.min(1,(performance.now()-t0)/dur),v=target*(1-Math.pow(1-p,3));
      el.textContent=(dec?v.toFixed(dec):Math.round(v))+suffix;
      if(p>=1)clearInterval(iv);
    },16);
  }
}
const co=new IntersectionObserver(entries=>{
  entries.forEach(e=>{if(e.isIntersecting){countEl(e.target);co.unobserve(e.target);}});
},{threshold:0.3});
document.querySelectorAll('[data-count]').forEach(el=>co.observe(el));
"""

    if extra_js:
        page += '\n' + extra_js + '\n'

    page += """
// FAQ ACCORDION
function toggleFaq(btn){
  const item=btn.closest('.faq-item');
  const ans=item.querySelector('.faq-a');
  const isOpen=btn.classList.contains('open');
  document.querySelectorAll('.faq-q.open').forEach(function(q){
    q.classList.remove('open');
    const t=q.querySelector('.faq-toggle');if(t)t.textContent='+';
    q.closest('.faq-item').querySelector('.faq-a').style.maxHeight='0';
  });
  if(!isOpen){
    btn.classList.add('open');
    ans.style.maxHeight=ans.scrollHeight+'px';
    const t=btn.querySelector('.faq-toggle');if(t)t.textContent='−';
  }
}
</script>
"""

    # Chat widget
    page += '\n' + chat_html + '\n'
    # Chat JS
    page += """<script>
(function(){
const APIKEY='ANTHROPIC_API_KEY_HERE';
const SYSTEM="Du bist der offizielle SourceOn Assistent. SourceOn ist ein Schweizer B2B Beschaffungsvermittler für die Baubranche. Provision: 2.25% auf Materialwert, nur bei nachgewiesener Ersparnis. Antworte immer auf Deutsch, kurz und präzise, maximal 3 Sätze.";
let history=[];let chatOpen=false;
window.toggleChat=function(){chatOpen=!chatOpen;document.getElementById('chat-win').classList.toggle('open',chatOpen);if(chatOpen&&document.getElementById('chat-msgs').children.length===0)addBotMsg('Hallo! Ich bin der SourceOn Assistent. Wie kann ich dir helfen?');};
window.sendChip=function(el){document.getElementById('chat-chips').style.display='none';handleSend(el.textContent);};
window.chatSend=function(){const inp=document.getElementById('chat-input');const txt=inp.value.trim();if(!txt)return;inp.value='';handleSend(txt);};
function addUserMsg(txt){const el=document.createElement('div');el.className='chat-msg chat-msg-user';el.textContent=txt;document.getElementById('chat-msgs').appendChild(el);scrollBottom();}
function addBotMsg(txt){const wrap=document.createElement('div');const lbl=document.createElement('div');lbl.className='chat-msg-label';lbl.textContent='SourceOn';const el=document.createElement('div');el.className='chat-msg chat-msg-bot';el.textContent=txt;wrap.appendChild(lbl);wrap.appendChild(el);document.getElementById('chat-msgs').appendChild(wrap);scrollBottom();}
function showTyping(){const el=document.createElement('div');el.className='chat-typing';el.id='chat-typing';el.innerHTML='<span></span><span></span><span></span>';document.getElementById('chat-msgs').appendChild(el);scrollBottom();}
function hideTyping(){const el=document.getElementById('chat-typing');if(el)el.remove();}
function scrollBottom(){const m=document.getElementById('chat-msgs');m.scrollTop=m.scrollHeight;}
async function handleSend(txt){addUserMsg(txt);history.push({role:'user',content:txt});if(history.length>20)history=history.slice(-20);if(APIKEY==='ANTHROPIC_API_KEY_HERE'){addBotMsg('Assistent wird bald verfügbar. Kontaktiere uns direkt: info@sourceon.ch');return;}showTyping();try{const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':APIKEY,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:300,system:SYSTEM,messages:history})});const d=await r.json();const reply=d.content&&d.content[0]?d.content[0].text:'Entschuldigung. Kontaktiere uns: info@sourceon.ch';hideTyping();history.push({role:'assistant',content:reply});if(history.length>20)history=history.slice(-20);addBotMsg(reply);}catch(e){hideTyping();addBotMsg('Verbindungsfehler. Kontaktiere uns: info@sourceon.ch');}
}
})();
</script>
"""
    page += '\n</body>\n</html>'
    return page

# ---- BUILD EACH SUBPAGE ----

# PROZESS.html
marquee_js = """
// MARQUEE
const SUPPLIERS=[
  {name:'Beton Partner Zürich',cat:'Beton & Tiefbau'},
  {name:'Stahlhandel Schweiz AG',cat:'Armierungsstahl'},
  {name:'Kies & Baustoffe GmbH',cat:'Schüttgut'},
  {name:'Mauerwerk Schweiz',cat:'Ziegel & Steine'},
  {name:'Dämmtechnik AG',cat:'Dämmung & Isolation'},
  {name:'Holcim Partner CH',cat:'Beton & Zement'},
  {name:'Schalung & Bau AG',cat:'Schalungssysteme'},
  {name:'Sanitär Schweiz GmbH',cat:'HLKS & Sanitär'},
  {name:'Armierung Pro CH',cat:'Bewehrungsstahl'},
  {name:'Baustoffe Regional AG',cat:'Vollsortiment'},
];
function buildMQ(id,items){
  const t=document.getElementById(id);
  if(!t)return;
  [...items,...items].forEach(s=>{
    const d=document.createElement('div');d.className='mq-card';
    d.innerHTML='<div class="mq-name">'+s.name+'</div><div class="mq-cat">'+s.cat+'</div>';
    t.appendChild(d);
  });
}
buildMQ('mq1',SUPPLIERS);
"""

prozess_page = make_subpage('Wie es funktioniert', [
    process_html, why_html, comparison_html, zahlen_html
])
open('prozess.html', 'w').write(prozess_page)

# MATERIALIEN.html
mat_lookup_js = """
// MATERIAL LOOKUP
const MATERIAL_DB=[
  {cat:'Rohbau Kern',items:['Transportbeton C20/25','Transportbeton C25/30','Transportbeton C30/37','Transportbeton C35/45','Pumpbeton XC4 druckwasserdicht','Armierungsstahl Ø 8mm','Armierungsstahl Ø 10mm','Armierungsstahl Ø 12mm','Armierungsstahl Ø 16mm','Armierungsstahl Ø 20mm','Armierungsmatte Q188','Armierungsmatte Q257','Armierungsmatte Q335','Betonstahlkörbe vorgefertigt','Kies 0–32mm','Kies 0–16mm','Splitt 8–16mm','Splitt 16–32mm','Sand 0–4mm','Hochlochziegel 15cm','Hochlochziegel 20cm','Hochlochziegel 25cm','Kalksandstein 15cm','Porenbetonstein 20cm','Mauermörtel MG II','Mauermörtel MG III','Putzmörtel Innen GP','Putzmörtel Aussen R','Estrichmörtel CT-C25','Klebemörtel C1 Fliesen','Schalungsplatte 21mm','Schalungsplatte 27mm','Systemschalung Wand Miet','Träger H20 Holzträger','Stahlstützen ausziehbar','Betonfertigteil Treppe','Betonfertigteil Deckenplatte Spannbeton','Betonfertigteil Stütze']},
  {cat:'Ausbau',items:['EPS-Dämmplatte 100mm Perimeter','EPS-Dämmplatte 140mm Fassade WDVS','EPS-Dämmplatte 200mm Flachdach','Mineralwolle 80mm Trennwand','Mineralwolle 120mm Steildach','XPS-Dämmplatte 80mm Bodenplatte','Gipskartonplatte GKB 12.5mm Standard','Gipskartonplatte GKBI 12.5mm Feuchtraum','Gipskartonplatte GKF 12.5mm Brandschutz','Metallständerwerk CW 75mm','Metallanschlussprofil UA 75mm','Tondachziegel Standard','Betonroofziegel','Dachabdichtungsbahn EPDM 1.5mm','Fassadenplatte Faserzement hinterlüftet']},
  {cat:'Haustechnik',items:['Kunststoffrohr PVC-U DN 110 Abwasser','Kunststoffrohr PP DN 50 Entwässerung','Kupferrohr 22mm Trinkwasser','Verbundrohr PE-RT/Al 16mm Heizung','Heizungsverteiler Fussbodenheizung']},
];
const MAT_CODE={'Rohbau Kern':'RB','Ausbau':'AB','Haustechnik':'HT'};
(function(){
  const sel=document.getElementById('mat-lookup-select');
  if(!sel)return;
  MATERIAL_DB.forEach(group=>{
    const og=document.createElement('optgroup');
    og.label=group.cat;
    group.items.forEach((name,i)=>{
      const id='SO-'+MAT_CODE[group.cat]+'-'+String(i+1).padStart(2,'0');
      const opt=document.createElement('option');
      opt.value=id;opt.textContent=name;opt.dataset.cat=group.cat;opt.dataset.name=name;
      og.appendChild(opt);
    });
    sel.appendChild(og);
  });
  sel.addEventListener('change',()=>{
    const opt=sel.options[sel.selectedIndex];
    if(!opt.value){document.getElementById('mat-lookup-id').textContent='SO–000';document.getElementById('mat-lookup-name').textContent='Noch kein Material ausgewählt';document.getElementById('mat-lookup-cat').textContent='—';return;}
    document.getElementById('mat-lookup-id').textContent=opt.value;
    document.getElementById('mat-lookup-name').textContent=opt.dataset.name;
    document.getElementById('mat-lookup-cat').textContent=opt.dataset.cat;
  });
})();
(function(){const track=document.getElementById('mat-strip-track');if(track)track.innerHTML+=track.innerHTML;})();
""" + marquee_js

# Add bento modal JS
bento_js = """
// BENTO TILE DETAIL MODAL
function closeBentoModal(){document.getElementById('bento-modal').classList.remove('open');}
document.querySelectorAll('.bento-tile[data-detail-title]').forEach(tile=>{
  tile.addEventListener('click',()=>{
    document.getElementById('bento-modal-title').textContent=tile.getAttribute('data-detail-title');
    document.getElementById('bento-modal-text').textContent=tile.getAttribute('data-detail-text');
    document.getElementById('bento-modal').classList.add('open');
  });
});
var bentoModal=document.getElementById('bento-modal');
if(bentoModal)bentoModal.addEventListener('click',e=>{if(e.target.id==='bento-modal')closeBentoModal();});
"""

# For materialien, we need the bento modal HTML
bento_modal_html = """
<div id="bento-modal" class="bento-modal">
  <div class="bento-modal-card">
    <button class="bento-modal-close" onclick="closeBentoModal()"><svg class="ic-x" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    <h3 id="bento-modal-title"></h3>
    <p id="bento-modal-text"></p>
  </div>
</div>
"""

materialien_page = make_subpage('Materialien & Lieferanten', [
    bento_modal_html, matnorms_html, materials_html, suppliers_html
], extra_js=mat_lookup_js + bento_js)
open('materialien.html', 'w').write(materialien_page)

# FUER-WEN.html
fuerwen_page = make_subpage('Für wen', [forwhom_html])
open('fuer-wen.html', 'w').write(fuerwen_page)

# LIEFERANT.html
supplier_top_link = """
<section style="background:var(--dark3);padding:20px 0">
  <div class="container" style="text-align:right">
    <a href="supplier-login.html" class="btn btn-outline-w btn-md">Bereits registriert? Zum Lieferanten-Login →</a>
  </div>
</section>
"""
supplier_js = """
// FORMS
function req(id,errId){const ok=document.getElementById(id).value.trim().length>0;document.getElementById(errId).style.display=ok?'none':'block';return ok;}
function emailOk(id,errId){const ok=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(document.getElementById(id).value.trim());document.getElementById(errId).style.display=ok?'none':'block';return ok;}
function selOk(id,errId){const ok=document.getElementById(id).value!=='';document.getElementById(errId).style.display=ok?'none':'block';return ok;}

var _sbClient=window.supabase?window.supabase.createClient('https://kiyoklfuqjzrlrbtxecq.supabase.co','sb_publishable_tLgWMkxbLWUvmluogsBl1w_-8zYPa_8'):null;
async function submitSupplier(e){
  e.preventDefault();
  var errEl=document.getElementById('error-supplier');
  errEl.style.display='none';
  if(![req('sa-company','e-sa-company'),req('sa-name','e-sa-name'),emailOk('sa-email','e-sa-email'),req('sa-phone','e-sa-phone'),selOk('sa-cap','e-sa-cap')].every(Boolean))return;
  var btn=document.querySelector('#form-supplier button[type=submit]');
  btn.disabled=true;btn.textContent='Wird gesendet…';
  var email=document.getElementById('sa-email').value.trim();
  var tempPw='SO-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);
  function getChecked(container){return Array.from(container.querySelectorAll('input[type=checkbox]:checked')).map(function(c){return c.parentElement.querySelector('span').textContent;});}
  var formEl=document.getElementById('form-supplier');
  var matChecks=formEl.querySelectorAll('.form-checks')[0];
  var regChecks=formEl.querySelectorAll('.form-checks')[1];
  var certChecks=formEl.querySelector('.form-checks-3');
  if(!_sbClient){errEl.textContent='Verbindung fehlgeschlagen. Bitte lade die Seite neu.';errEl.style.display='block';btn.disabled=false;btn.textContent='Jetzt als Partnerlieferant bewerben';return;}
  var authRes=await _sbClient.auth.signUp({email:email,password:tempPw});
  if(authRes.error){errEl.textContent='Registrierung fehlgeschlagen: '+authRes.error.message;errEl.style.display='block';btn.disabled=false;btn.textContent='Jetzt als Partnerlieferant bewerben';return;}
  var loginRes=await _sbClient.auth.signInWithPassword({email:email,password:tempPw});
  if(loginRes.error){errEl.textContent='Automatischer Login fehlgeschlagen: '+loginRes.error.message;errEl.style.display='block';btn.disabled=false;btn.textContent='Jetzt als Partnerlieferant bewerben';return;}
  var uid=loginRes.data.user.id;
  var insRes=await _sbClient.from('suppliers').insert({id:uid,company_name:document.getElementById('sa-company').value.trim(),contact_person:document.getElementById('sa-name').value.trim(),email:email,phone:document.getElementById('sa-phone').value.trim(),website:document.getElementById('sa-web')?document.getElementById('sa-web').value.trim():'',materials:getChecked(matChecks),regions:getChecked(regChecks),annual_capacity:document.getElementById('sa-cap').value,certifications:certChecks?getChecked(certChecks):[],notes:document.getElementById('sa-notes')?document.getElementById('sa-notes').value.trim():'',status:'pending'});
  if(insRes.error){errEl.textContent='Profil konnte nicht gespeichert werden: '+insRes.error.message;errEl.style.display='block';btn.disabled=false;btn.textContent='Jetzt als Partnerlieferant bewerben';return;}
  formEl.style.display='none';
  var successEl=document.getElementById('success-supplier');
  successEl.innerHTML='<span><svg class="ic-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span> Vielen Dank für deine Bewerbung. Wir prüfen dein Profil und melden uns innerhalb von 48 Stunden.<br><br><strong style="color:#E8A020">Dein temporäres Passwort:</strong> <code style="background:rgba(232,160,32,.12);padding:4px 10px;border-radius:6px;font-size:15px;user-select:all">'+tempPw+'</code><br><span style="font-size:13px;color:#94A3B8">Bitte notiere es dir — nach Verifizierung kannst du dich damit im <a href="supplier-login.html" style="color:#E8A020">Lieferanten-Portal</a> anmelden.</span>';
  successEl.classList.add('show');
}
"""
lieferant_page = make_subpage('Lieferant werden', [supplier_top_link, supplier_html], needs_supabase=True, extra_js=supplier_js)
open('lieferant.html', 'w').write(lieferant_page)

# UEBER-UNS.html
ueberuns_page = make_subpage('Über uns', [about_html, faq_html])
open('ueber-uns.html', 'w').write(ueberuns_page)

# KONTAKT.html
contact_js = """
// FORMS
function req(id,errId){const ok=document.getElementById(id).value.trim().length>0;document.getElementById(errId).style.display=ok?'none':'block';return ok;}
function emailOk(id,errId){const ok=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(document.getElementById(id).value.trim());document.getElementById(errId).style.display=ok?'none':'block';return ok;}
function selOk(id,errId){const ok=document.getElementById(id).value!=='';document.getElementById(errId).style.display=ok?'none':'block';return ok;}

let matRowCount=1;
const MAT_OPTIONS='<option value="">Material wählen</option><option>Beton</option><option>Armierungsstahl</option><option>Kies &amp; Splitt</option><option>Mauerwerk &amp; Ziegel</option><option>Dämmung</option><option>Schalung</option><option>Mörtel</option><option>Sanitär &amp; HLKS</option><option>Holz &amp; Baustoffe</option><option>Stahl &amp; Metall</option><option>Dach &amp; Fassade</option><option>Andere</option>';
function addMaterialRow(){
  if(matRowCount>=10)return;matRowCount++;
  const rows=document.getElementById('material-rows');
  const div=document.createElement('div');div.className='material-row';
  div.innerHTML='<select class="form-select mat-sel">'+MAT_OPTIONS+'</select><input type="text" class="form-input mat-qty" placeholder="z.B. 50 Tonnen"/><button type="button" class="mat-remove-btn" onclick="removeMaterialRow(this)" title="Entfernen"><svg class="ic-x" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>';
  rows.appendChild(div);
  if(matRowCount>=10)document.getElementById('add-material-btn').style.display='none';
}
function removeMaterialRow(btn){btn.closest('.material-row').remove();matRowCount--;document.getElementById('add-material-btn').style.display='';}
function validateMaterials(){
  const rows=document.querySelectorAll('#material-rows .material-row');
  const ok=Array.from(rows).some(r=>r.querySelector('.mat-sel').value&&r.querySelector('.mat-qty').value.trim());
  document.getElementById('e-c-material').style.display=ok?'none':'block';return ok;
}
function handleFileSelect(input){
  const file=input.files[0];if(!file)return;
  if(file.size>10*1024*1024){alert('Datei ist grösser als 10 MB.');input.value='';return;}
  document.getElementById('file-name').textContent=file.name;
  document.getElementById('file-selected').classList.add('show');
}
function removeFile(){document.getElementById('c-file').value='';document.getElementById('file-name').textContent='';document.getElementById('file-selected').classList.remove('show');}
(function(){
  const zone=document.getElementById('file-upload-zone');if(!zone)return;
  zone.addEventListener('dragover',e=>{e.preventDefault();zone.classList.add('drag-over');});
  zone.addEventListener('dragleave',()=>zone.classList.remove('drag-over'));
  zone.addEventListener('drop',e=>{e.preventDefault();zone.classList.remove('drag-over');const file=e.dataTransfer.files[0];if(file){document.getElementById('c-file').files=e.dataTransfer.files;handleFileSelect(document.getElementById('c-file'));}});
})();
function submitContact(e){
  e.preventDefault();
  const matOk=validateMaterials();
  if([req('c-company','e-c-company'),req('c-name','e-c-name'),emailOk('c-email','e-c-email'),req('c-phone','e-c-phone'),matOk,selOk('c-timing','e-c-timing'),req('c-canton','e-c-canton')].every(Boolean)){
    document.getElementById('form-contact').style.display='none';
    document.getElementById('success-contact').classList.add('show');
  }
}
"""
kontakt_page = make_subpage('Kontakt', [contact_html], extra_js=contact_js)
open('kontakt.html', 'w').write(kontakt_page)

# ---- BUILD NEW HOMEPAGE ----
# Homepage keeps: nav, hero, word reveal, calculator, bignum, tech/chip, bundling 3D, nav cards, CTA, footer

# Update CTA buttons on homepage to link to kontakt.html
cta_homepage = cta_html.replace("smoothScrollToEl(document.getElementById('contact'))", "window.location.href='kontakt.html'")

homepage_head = head_template.replace('</style>', nav_cards_css + '</style>')

new_index = homepage_head + '\n</head>\n<body>\n'
new_index += nav_multipage + '\n\n'
new_index += hero_html + '\n\n'
new_index += wordreveal_html + '\n\n'
new_index += calculator_html.replace("smoothScrollToEl(document.getElementById('contact'))", "window.location.href='kontakt.html'") + '\n\n'
new_index += bignum_html + '\n\n'
new_index += tech_html.replace('href="#contact"', 'href="kontakt.html"') + '\n\n'
new_index += bundling_section_html + '\n\n'
new_index += nav_cards_html + '\n\n'
new_index += cta_homepage + '\n\n'
new_index += footer_multipage + '\n\n'

# Scripts for homepage
new_index += threejs_include + '\n'
new_index += '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>\n'
new_index += threejs_script + '\n\n'

# Homepage JS
new_index += """<script>
// SMOOTH ANCHOR SCROLL
function easeOutExpo(t){return t===1?1:1-Math.pow(2,-10*t);}
function smoothScrollToEl(target,duration){
  const startY=window.scrollY;
  const endY=target.getBoundingClientRect().top+startY;
  const dist=endY-startY;
  duration=duration||Math.min(900,Math.max(420,Math.abs(dist)*.5));
  const t0=performance.now();
  function step(now){
    const p=Math.min(1,(now-t0)/duration);
    window.scrollTo(0,startY+dist*easeOutExpo(p));
    if(p<1)requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}
document.querySelectorAll('a[href^="#"]').forEach(a=>{
  a.addEventListener('click',function(e){
    const id=a.getAttribute('href');
    if(id.length<2)return;
    const target=document.querySelector(id);
    if(!target)return;
    e.preventDefault();
    smoothScrollToEl(target);
  });
});

// NAV
let lastScrollY=window.scrollY;
window.addEventListener('scroll',()=>{
  const nav=document.getElementById('nav');
  const y=window.scrollY;
  nav.classList.toggle('scrolled',y>40);
  if(y>140&&y>lastScrollY){nav.classList.add('nav-hidden')}
  else if(y<lastScrollY){nav.classList.remove('nav-hidden')}
  lastScrollY=y;
});
function toggleNav(){
  const o=document.getElementById('nav-overlay');
  o.classList.toggle('open');
  document.body.style.overflow=o.classList.contains('open')?'hidden':'';
}

// STORY SENTENCE SCROLL REVEAL
(function(){
  const el=document.getElementById('story-sentence');
  if(!el)return;
  const text=el.textContent;
  el.innerHTML=text.split(' ').map(w=>'<span class="word">'+w+'</span>').join(' ');
  const words=el.querySelectorAll('.word');
  function update(){
    const rect=el.parentElement.parentElement.getBoundingClientRect();
    const vh=window.innerHeight;
    const progress=Math.min(1,Math.max(0,(vh*0.8-rect.top)/(rect.height-vh*0.2)));
    const litCount=Math.round(progress*words.length);
    words.forEach((w,i)=>w.classList.toggle('lit',i<litCount));
  }
  window.addEventListener('scroll',update,{passive:true});
  update();
})();

// HERO HEADLINE WORD STAGGER
(function(){
  const h=document.getElementById('hero-h1');
  if(!h)return;
  function wrapWords(node){
    if(node.nodeType===3){
      const words=node.textContent.split(/(\\s+)/);
      const frag=document.createDocumentFragment();
      words.forEach(w=>{
        if(/\\S/.test(w)){const s=document.createElement('span');s.className='hw';s.textContent=w;frag.appendChild(s);}
        else if(w){frag.appendChild(document.createTextNode(w));}
      });
      node.parentNode.replaceChild(frag,node);
    } else if(node.nodeType===1&&node.nodeName!=='SCRIPT'){
      [...node.childNodes].forEach(wrapWords);
    }
  }
  wrapWords(h);
  const spans=h.querySelectorAll('.hw');
  spans.forEach((s,i)=>setTimeout(()=>s.classList.add('in'),100+i*150));
})();

// SCROLL REVEAL
const ro=new IntersectionObserver(entries=>{
  entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('visible');ro.unobserve(e.target);}});
},{threshold:0.1});
document.querySelectorAll('.reveal,.slide-left').forEach(el=>ro.observe(el));

// COUNTERS
function countEl(el,dur){
  dur=dur||1200;
  const t0=performance.now();
  if(el.dataset.count!==undefined){
    const target=parseFloat(el.dataset.count),suffix=el.dataset.suffix||'',dec=parseInt(el.dataset.dec||0);
    const iv=setInterval(()=>{
      const p=Math.min(1,(performance.now()-t0)/dur),v=target*(1-Math.pow(1-p,3));
      el.textContent=(dec?v.toFixed(dec):Math.round(v))+suffix;
      if(p>=1)clearInterval(iv);
    },16);
  }
}
document.querySelectorAll('.hero-stats [data-count]').forEach(el=>countEl(el,2000));
const co=new IntersectionObserver(entries=>{
  entries.forEach(e=>{if(e.isIntersecting){countEl(e.target);co.unobserve(e.target);}});
},{threshold:0.3});
document.querySelectorAll('[data-count]').forEach(el=>{
  if(!el.closest('.hero-stats'))co.observe(el);
});

// CALCULATOR
const MIN_V=50000,MAX_V=10000000;
const TIERS=[
  {max:150000,rate:.07},{max:300000,rate:.10},{max:600000,rate:.13},
  {max:1200000,rate:.16},{max:3000000,rate:.20},{max:6000000,rate:.24},{max:Infinity,rate:.28}
];
function posToVal(p){return Math.round(MIN_V*Math.pow(MAX_V/MIN_V,p/100)/1000)*1000;}
function valToPos(v){return Math.log(v/MIN_V)/Math.log(MAX_V/MIN_V)*100;}
function getTier(v){return TIERS.find(t=>v<=t.max)||TIERS[TIERS.length-1];}
function fmtChf(n){return'CHF '+Math.round(n).toLocaleString('de-CH');}
let animTimer=null;
function animateNum(id,target){
  if(animTimer)clearInterval(animTimer);
  const el=document.getElementById(id);const t0=performance.now();
  animTimer=setInterval(()=>{
    const p=Math.min(1,(performance.now()-t0)/600);
    el.textContent=fmtChf(target*(1-Math.pow(1-p,3)));
    if(p>=1)clearInterval(animTimer);
  },16);
}
function updateCalc(v,fromSlider){
  v=Math.max(MIN_V,fromSlider?Math.min(MAX_V,v):v);
  const tier=getTier(v);
  const gross=v*tier.rate,net=gross-v*0.0225;
  document.getElementById('calc-display').textContent=fmtChf(v);
  if(fromSlider)document.getElementById('calc-input').value=Math.round(v).toLocaleString('de-CH');
  document.getElementById('calc-rate').textContent=Math.round(tier.rate*100)+'%';
  document.getElementById('calc-gross').textContent=fmtChf(gross);
  animateNum('calc-net',net);
  const pos=valToPos(Math.min(v,MAX_V));
  const sl=document.getElementById('calc-slider');
  sl.value=pos;sl.style.setProperty('--pct',pos+'%');
}
document.getElementById('calc-slider').addEventListener('input',function(){
  this.style.setProperty('--pct',this.value+'%');updateCalc(posToVal(+this.value),true);
});
document.getElementById('calc-input').addEventListener('input',function(){
  const v=parseInt(this.value.replace(/['\\s.,]/g,''),10);
  if(!isNaN(v)&&v>=MIN_V)updateCalc(v,false);
});
updateCalc(150000);

// BUNDLING DIAGRAM ANIMATION
const bdObs=new IntersectionObserver(entries=>{
  entries.forEach(e=>{
    if(e.isIntersecting){
      e.currentTarget.querySelectorAll('.bd-company,.bd-SourceOn-card,.bd-lieferant-card').forEach(el=>el.classList.add('bd-in'));
      bdObs.unobserve(e.currentTarget);
    }
  });
},{threshold:0.2});
const bdDiagram=document.getElementById('bd-diagram');
if(bdDiagram)bdObs.observe(bdDiagram);

// ENGINE VISUAL
(function(){
  const stage=document.getElementById('engine-stage');
  if(!stage)return;
  const io=new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      if(e.isIntersecting){
        stage.classList.add('is-visible');
        stage.querySelectorAll('animateMotion.chipAnim').forEach(function(a){
          try{a.beginElement();}catch(err){}
        });
        io.disconnect();
      }
    });
  },{threshold:.3});
  io.observe(stage);
})();

// FAQ (stub for pages that might have inline FAQ)
function toggleFaq(btn){}
</script>
"""

# Chat widget
new_index += '\n' + chat_html + '\n'
# Chat JS
new_index += """<script>
(function(){
const APIKEY='ANTHROPIC_API_KEY_HERE';
const SYSTEM="Du bist der offizielle SourceOn Assistent. SourceOn ist ein Schweizer B2B Beschaffungsvermittler für die Baubranche. Provision: 2.25% auf Materialwert, nur bei nachgewiesener Ersparnis. Antworte immer auf Deutsch, kurz und präzise, maximal 3 Sätze.";
let history=[];let chatOpen=false;
window.toggleChat=function(){chatOpen=!chatOpen;document.getElementById('chat-win').classList.toggle('open',chatOpen);if(chatOpen&&document.getElementById('chat-msgs').children.length===0)addBotMsg('Hallo! Ich bin der SourceOn Assistent. Wie kann ich dir helfen?');};
window.sendChip=function(el){document.getElementById('chat-chips').style.display='none';handleSend(el.textContent);};
window.chatSend=function(){const inp=document.getElementById('chat-input');const txt=inp.value.trim();if(!txt)return;inp.value='';handleSend(txt);};
function addUserMsg(txt){const el=document.createElement('div');el.className='chat-msg chat-msg-user';el.textContent=txt;document.getElementById('chat-msgs').appendChild(el);scrollBottom();}
function addBotMsg(txt){const wrap=document.createElement('div');const lbl=document.createElement('div');lbl.className='chat-msg-label';lbl.textContent='SourceOn';const el=document.createElement('div');el.className='chat-msg chat-msg-bot';el.textContent=txt;wrap.appendChild(lbl);wrap.appendChild(el);document.getElementById('chat-msgs').appendChild(wrap);scrollBottom();}
function showTyping(){const el=document.createElement('div');el.className='chat-typing';el.id='chat-typing';el.innerHTML='<span></span><span></span><span></span>';document.getElementById('chat-msgs').appendChild(el);scrollBottom();}
function hideTyping(){const el=document.getElementById('chat-typing');if(el)el.remove();}
function scrollBottom(){const m=document.getElementById('chat-msgs');m.scrollTop=m.scrollHeight;}
async function handleSend(txt){addUserMsg(txt);history.push({role:'user',content:txt});if(history.length>20)history=history.slice(-20);if(APIKEY==='ANTHROPIC_API_KEY_HERE'){addBotMsg('Assistent wird bald verfügbar. Kontaktiere uns direkt: info@sourceon.ch');return;}showTyping();try{const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':APIKEY,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:300,system:SYSTEM,messages:history})});const d=await r.json();const reply=d.content&&d.content[0]?d.content[0].text:'Entschuldigung. Kontaktiere uns: info@sourceon.ch';hideTyping();history.push({role:'assistant',content:reply});if(history.length>20)history=history.slice(-20);addBotMsg(reply);}catch(e){hideTyping();addBotMsg('Verbindungsfehler. Kontaktiere uns: info@sourceon.ch');}
}
})();
</script>
"""
new_index += '\n</body>\n</html>'

open('index.html', 'w').write(new_index)

print("\n=== ALL PAGES CREATED ===")
for f in ['index.html','prozess.html','materialien.html','fuer-wen.html','lieferant.html','ueber-uns.html','kontakt.html']:
    content = open(f).read()
    print(f"{f}: {len(content)} bytes, {content.count(chr(10))} lines")
