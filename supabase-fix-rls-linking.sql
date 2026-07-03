-- ============================================================================
-- SourceOn — Fix: Materialanfragen verschwinden beim Verknüpfen mit dem Konto
-- ----------------------------------------------------------------------------
-- Ursache: Auf den Tabellen customers / material_requests fehlen UPDATE- (und
-- DELETE-) RLS-Policies. Client-seitige UPDATEs werden von RLS still blockiert
-- (leeres Ergebnis, KEIN Fehler) -> die Anfrage wird nicht verschoben und die
-- Temp-Kundenzeile fälschlich gelöscht.
--
-- WICHTIG: customers.user_id enthält die CLERK-User-ID (Text, z.B. "user_3F...").
-- Deshalb wird gegen  auth.jwt()->>'sub'  geprüft (NICHT auth.uid()).
--
-- Ausführen im Supabase-Dashboard:  SQL Editor  ->  einfügen  ->  Run.
-- Die Blöcke sind einzeln ausführbar. Erst SCHRITT 0 zum Prüfen laufen lassen.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- SCHRITT 0 — DIAGNOSE: welche Policies existieren aktuell?
-- ----------------------------------------------------------------------------
select tablename, policyname, cmd, roles
from pg_policies
where tablename in ('customers','material_requests')
order by tablename, cmd;
-- Erwartung: Es gibt vermutlich nur SELECT/INSERT, aber KEIN UPDATE / DELETE.
-- Genau das ist die Ursache.


-- ----------------------------------------------------------------------------
-- SCHRITT 1 — CUSTOMERS: UPDATE-/DELETE-Policies ergänzen
-- ----------------------------------------------------------------------------

-- 1a) Frisch angelegte, noch nicht verknüpfte Kundenzeile darf vom
--     eingeloggten Nutzer beansprucht werden (10-Minuten-Fenster).
drop policy if exists "claim_fresh_customer" on customers;
create policy "claim_fresh_customer"
  on customers for update to authenticated
  using  (user_id is null and created_at > now() - interval '10 minutes')
  with check (user_id = auth.jwt()->>'sub');

-- 1b) Eigene (bereits verknüpfte) Kundenzeilen darf der Nutzer aktualisieren.
drop policy if exists "update_own_customer" on customers;
create policy "update_own_customer"
  on customers for update to authenticated
  using  (user_id = auth.jwt()->>'sub')
  with check (user_id = auth.jwt()->>'sub');

-- 1c) Eigene Kundenzeile darf gelöscht werden (nötig, um doppelte Temp-Zeile
--     nach dem Verschieben der Anfragen zu entfernen).
drop policy if exists "delete_own_customer" on customers;
create policy "delete_own_customer"
  on customers for delete to authenticated
  using (user_id = auth.jwt()->>'sub');


-- ----------------------------------------------------------------------------
-- SCHRITT 2 — MATERIAL_REQUESTS: UPDATE-Policies ergänzen
-- ----------------------------------------------------------------------------

-- 2a) Anfragen, die zu einer dem Nutzer gehörenden Kundenzeile gehören,
--     dürfen aktualisiert werden (z.B. customer_id auf die primäre Zeile setzen).
drop policy if exists "update_own_requests" on material_requests;
create policy "update_own_requests"
  on material_requests for update to authenticated
  using  (customer_id in (select id from customers where user_id = auth.jwt()->>'sub'))
  with check (customer_id in (select id from customers where user_id = auth.jwt()->>'sub'));

-- 2b) Anfragen einer frisch angelegten, noch unverknüpften Kundenzeile
--     (10-Minuten-Fenster) dürfen verschoben werden.
drop policy if exists "update_fresh_requests" on material_requests;
create policy "update_fresh_requests"
  on material_requests for update to authenticated
  using (
    customer_id in (
      select id from customers
      where user_id is null and created_at > now() - interval '10 minutes'
    )
  );

-- Hinweis: Eine SELECT-Policy auf material_requests für eigene Kunden existiert
-- bereits (das Dashboard liest die Anfragen). Falls nicht, hier ergänzen:
-- drop policy if exists "read_own_requests" on material_requests;
-- create policy "read_own_requests"
--   on material_requests for select to authenticated
--   using (customer_id in (select id from customers where user_id = auth.jwt()->>'sub'));


-- ----------------------------------------------------------------------------
-- SCHRITT 3 — DATENRETTUNG: verlorene/verwaiste Anfrage wieder anhängen
-- ----------------------------------------------------------------------------

-- 3a) Prüfen: gibt es Anfragen, deren customer_id auf keine existierende
--     Kundenzeile mehr zeigt (verwaist durch das versehentliche Löschen)?
select id, customer_id, sourceon_id, menge, einheit, created_at
from material_requests
where customer_id not in (select id from customers)
order by created_at desc;

-- 3b) Falls oben Zeilen erscheinen (z.B. die 5 m² SO-DAE-006 XPS-Dämmplatte):
--     an die richtige Kundenzeile umhängen.
--     -> Ersetze die Ziel-UUID falls nötig; 8a3b2ea9... ist deine bestehende
--        Kundenzeile "SourceOn".
update material_requests
set customer_id = '8a3b2ea9-bdbf-4aad-83ec-30a2fff9857b'
where customer_id not in (select id from customers);

-- 3c) Kontrolle: jetzt sollten alle Anfragen unter deiner Kundenzeile hängen.
select id, sourceon_id, menge, einheit, created_at
from material_requests
where customer_id = '8a3b2ea9-bdbf-4aad-83ec-30a2fff9857b'
order by created_at desc;

-- HINWEIS: Zeigt SCHRITT 3a KEINE Zeile, wurde die Anfrage beim Löschen der
-- Kundenzeile per Foreign-Key-CASCADE mitgelöscht und ist unwiederbringlich weg
-- -> in dem Fall bitte einmal neu absenden (mit dem gefixten Code passiert das
--    nicht mehr).
-- ============================================================================
