-- Lese-Policies verschaerfen: keine anonyme Einsicht mehr in Lieferanten-
-- Kontaktdaten und Bundle-Geschaeftsdaten.
--
-- Vorher:
--   suppliers: SELECT fuer alle mit status='verified' -> anon liest email/phone/
--              contact_person JEDES verifizierten Lieferanten.
--   bundles:   SELECT using(true) -> anon liest Volumen/Zielrabatt/Zonen aller Bundles.
--
-- Frontend-Realitaet (geprueft): Seiten lesen suppliers NUR als eigene Zeile
-- (id = eigene Clerk-ID) zum Status-Check; es gibt keine oeffentliche
-- Lieferantenliste. bundles werden gelesen von (a) verifizierten Lieferanten
-- (offene Ausschreibungen zum Bieten + eigene Gebote/Zuschlaege) und
-- (b) Kunden fuer Bundles, die ihre eigenen Bedarfe enthalten.
--
-- Idempotent.

-- ----------------------------------------------------------------------------
-- suppliers: SELECT nur noch die EIGENE Zeile (kein oeffentlicher verified-Zweig).
-- Kontaktdaten sind damit fuer Anonyme/Fremde unsichtbar. Admin liest weiter
-- ueber die Edge-Function mit Service-Key (RLS umgangen).
-- ----------------------------------------------------------------------------
-- In der Live-DB heisst die korrekte Policy bereits suppliers_select_own_clerk
-- (id = auth.jwt()->>'sub'). Wir droppen nur die evtl. aus rls_policies.sql
-- stammende oeffentliche Variante; die eigene-Zeile-Policy bleibt bestehen.
drop policy if exists suppliers_select_public_verified on public.suppliers;

-- ----------------------------------------------------------------------------
-- bundles: SELECT nur fuer Beteiligte (kein using(true) mehr).
--   * verifizierte Lieferanten: offene Ausschreibungen (zum Bieten)
--   * Lieferanten mit eigenem Gebot auf dem Bundle
--   * der Gewinner-Lieferant des Bundles
--   * Kunden, deren eigene Bedarfe im Bundle stecken
-- Anonyme (requesting_user_id() = NULL) sehen nichts.
-- ----------------------------------------------------------------------------
drop policy if exists bundles_select_public on public.bundles;
drop policy if exists bundles_read_all on public.bundles;                        -- Legacy using(true), nur in Live-DB
drop policy if exists bundles_select_for_verified_suppliers_clerk on public.bundles;
drop policy if exists bundles_select_participants on public.bundles;
-- Hinweis: die Live-DB hat KEINE Funktion requesting_user_id() — die echten
-- Policies nutzen direkt auth.jwt() ->> 'sub'. Deshalb hier ebenso.
create policy bundles_select_participants on public.bundles
  for select using (
    (
      status = 'ausgeschrieben'
      and exists (
        select 1 from public.suppliers s
        where s.id = (auth.jwt() ->> 'sub') and s.status = 'verified'
      )
    )
    or exists (
      select 1 from public.bids b
      where b.bundle_id = bundles.id and b.supplier_id = (auth.jwt() ->> 'sub')
    )
    or gewonnener_supplier_id = (auth.jwt() ->> 'sub')
    or exists (
      select 1 from public.material_requests mr
      join public.customers c on c.id = mr.customer_id
      where mr.bundle_id = bundles.id and c.user_id = (auth.jwt() ->> 'sub')
    )
  );
