-- ============================================================================
-- SourceOn — RLS-Policies (Ziel-Zustand)
-- ============================================================================
-- ⚠️ WICHTIG — an EURE tatsächliche Architektur angepasst, NICHT die Vorgabe 1:1:
--
-- 1) AUTH: Ihr nutzt CLERK, nicht Supabase-Auth. Die User-ID kommt aus dem
--    Clerk-JWT-Claim `sub` — NICHT aus auth.uid(). Voraussetzung: Clerk ist in
--    Supabase als "Third-Party Auth" eingerichtet, sonst greift KEINE dieser
--    Policies (das Token wird gar nicht validiert). Bitte zuerst prüfen!
--
-- 2) ÖFFENTLICHE FORMULARE schreiben ANONYM (kontakt/lieferant/sondermaterial)
--    und kontakt liest die neue Zeile zurück. Strikte "nur eigene Zeile"-Regeln
--    würden diese Formulare BRECHEN. EMPFOHLEN: Formular-Writes serverseitig über
--    eine Edge-Function (Service-Key) laufen lassen — wie beim Admin. DANN kann
--    anon INSERT komplett verboten werden. Solange das nicht umgebaut ist, bleibt
--    anon INSERT hier erlaubt (siehe Kommentare) — ein bewusster Kompromiss.
--
-- Vor dem Anwenden: erst die IST-Policies prüfen (Query am Ende) und JEDEN Flow
-- danach testen (Formular absenden, Dashboard laden, Angebot einreichen ...).
-- ============================================================================

-- Helfer: aktuelle Clerk-User-ID aus dem JWT
create or replace function public.requesting_user_id()
returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', auth.jwt() ->> 'sub')
$$;

-- ----------------------------------------------------------------------------
-- customers  (Spalte user_id = Clerk-ID; anfangs NULL bei anonymem Formular)
-- ----------------------------------------------------------------------------
alter table public.customers enable row level security;

drop policy if exists customers_select_own on public.customers;
create policy customers_select_own on public.customers
  for select using (user_id = public.requesting_user_id());

-- Anon-Formular darf einfügen (user_id noch NULL) ODER eingeloggt für sich selbst.
-- HINWEIS: Das erlaubt anonyme Inserts. Sauber wäre: Insert nur via Edge-Function.
drop policy if exists customers_insert on public.customers;
create policy customers_insert on public.customers
  for insert with check (user_id is null or user_id = public.requesting_user_id());

drop policy if exists customers_update_own on public.customers;
create policy customers_update_own on public.customers
  for update using (user_id = public.requesting_user_id())
             with check (user_id = public.requesting_user_id());

drop policy if exists customers_delete_own on public.customers;
create policy customers_delete_own on public.customers
  for delete using (user_id = public.requesting_user_id());

-- ----------------------------------------------------------------------------
-- material_requests  (customer_id -> customers.id)
-- ----------------------------------------------------------------------------
alter table public.material_requests enable row level security;

-- Kunde sieht eigene Anfragen. (Lieferanten sehen Bündel/Gebote, NICHT rohe
-- Anfragen — daher hier keine Lieferanten-SELECT-Regel; bei Bedarf ergänzen.)
drop policy if exists mr_select_own on public.material_requests;
create policy mr_select_own on public.material_requests
  for select using (
    customer_id in (select id from public.customers where user_id = public.requesting_user_id())
  );

-- Anon-Formular darf Anfragen einfügen (Kompromiss — sonst siehe Edge-Function).
drop policy if exists mr_insert on public.material_requests;
create policy mr_insert on public.material_requests
  for insert with check (true);

-- Kunde darf EIGENE Anfrage ändern (z.B. stornieren) — die App nutzt das.
drop policy if exists mr_update_own on public.material_requests;
create policy mr_update_own on public.material_requests
  for update using (
    customer_id in (select id from public.customers where user_id = public.requesting_user_id())
  );
-- (Alle weiteren Statuswechsel macht die Edge-Function mit Service-Key = umgeht RLS.)

-- ----------------------------------------------------------------------------
-- suppliers  (id = Clerk-ID; anonyme Bewerbung übers Formular)
-- ----------------------------------------------------------------------------
alter table public.suppliers enable row level security;

-- Öffentlich lesbar: nur VERIFIZIERTE (für Bündelungs-/Anzeigezwecke). Zusätzlich
-- darf ein eingeloggter Lieferant seinen EIGENEN Datensatz lesen (auch pending).
drop policy if exists suppliers_select_public_verified on public.suppliers;
create policy suppliers_select_public_verified on public.suppliers
  for select using (status = 'verified' or id = public.requesting_user_id());

-- Bewerbung: anonym oder für die eigene Clerk-ID.
drop policy if exists suppliers_insert on public.suppliers;
create policy suppliers_insert on public.suppliers
  for insert with check (id is null or id = public.requesting_user_id());

-- Profil bearbeiten: nur eigener Datensatz. (Status/Verifizierung ändert NUR die
-- Edge-Function mit Service-Key — nicht über eine Policy erreichbar.)
drop policy if exists suppliers_update_own on public.suppliers;
create policy suppliers_update_own on public.suppliers
  for update using (id = public.requesting_user_id())
             with check (id = public.requesting_user_id());

-- ----------------------------------------------------------------------------
-- bids  (supplier_id = Clerk-ID)
-- ----------------------------------------------------------------------------
alter table public.bids enable row level security;

drop policy if exists bids_select_own on public.bids;
create policy bids_select_own on public.bids
  for select using (supplier_id = public.requesting_user_id());

-- Nur verifizierte Lieferanten dürfen für sich selbst ein Gebot einfügen.
drop policy if exists bids_insert_own on public.bids;
create policy bids_insert_own on public.bids
  for insert with check (
    supplier_id = public.requesting_user_id()
    and exists (select 1 from public.suppliers s
                where s.id = public.requesting_user_id() and s.status = 'verified')
  );

-- Eigenes Gebot ändern (z.B. zurückziehen). Zuschlag/Status final = Service-Key.
drop policy if exists bids_update_own on public.bids;
create policy bids_update_own on public.bids
  for update using (supplier_id = public.requesting_user_id())
             with check (supplier_id = public.requesting_user_id());

-- ----------------------------------------------------------------------------
-- bundles  (öffentlich lesbar; schreiben nur Service-Key)
-- ----------------------------------------------------------------------------
alter table public.bundles enable row level security;
drop policy if exists bundles_select_public on public.bundles;
create policy bundles_select_public on public.bundles for select using (true);
-- KEINE insert/update/delete-Policy -> nur Service-Key (Edge-Function) darf schreiben.

-- ----------------------------------------------------------------------------
-- material_catalog  (Referenzdaten: öffentlich lesbar; schreiben nur Service-Key)
-- ----------------------------------------------------------------------------
alter table public.material_catalog enable row level security;
drop policy if exists material_catalog_select_public on public.material_catalog;
create policy material_catalog_select_public on public.material_catalog for select using (true);

-- ----------------------------------------------------------------------------
-- special_requests  (öffentliches Formular: nur INSERT; lesen nur Service-Key)
-- ----------------------------------------------------------------------------
alter table public.special_requests enable row level security;
drop policy if exists special_requests_insert_public on public.special_requests;
create policy special_requests_insert_public on public.special_requests for insert with check (true);
-- KEINE select-Policy -> anon kann NICHT lesen; nur Service-Key/Admin.

-- ============================================================================
-- IST-ZUSTAND PRÜFEN (vor dem Anwenden ausführen und mir schicken):
-- ============================================================================
-- select tablename, policyname, cmd, roles, qual, with_check
--   from pg_policies where schemaname='public' order by tablename, cmd;
--
-- Und prüfen, ob RLS überhaupt aktiv ist:
-- select relname, relrowsecurity from pg_class
--   where relnamespace='public'::regnamespace and relkind='r' order by relname;
-- ============================================================================
