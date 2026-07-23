-- ============================================================================
-- SourceOn — RLS-Lockdown (Teil 1: anonyme Direkt-Writes entfernen)
-- ============================================================================
-- Voraussetzung: Diese Formulare schreiben jetzt SERVERSEITIG über Edge-Functions
-- (mit Secret-Key, umgeht RLS):
--   • kontakt.html         -> submit-customer-request   (customers + material_requests)
--   • sondermaterial.html  -> submit-special-request    (special_requests)
-- Deshalb braucht der Browser (anon) KEINE direkten INSERT-Rechte mehr.
--
-- ⚠️ ERST AUSFÜHREN, wenn beide Functions live & getestet sind (sind sie).
-- Reversibel: die gedropten Policies stehen zum Wiederherstellen unten als Kommentar.
-- ============================================================================

begin;

-- customers: anonymer Direkt-INSERT weg (läuft über submit-customer-request).
drop policy if exists customers_insert_public on public.customers;

-- material_requests: anonymer Direkt-INSERT weg (läuft über submit-customer-request).
drop policy if exists material_requests_insert_public on public.material_requests;

-- special_requests: anonymer Direkt-INSERT weg (läuft über submit-special-request).
drop policy if exists special_requests_insert_public on public.special_requests;

commit;

-- ============================================================================
-- NOCH NICHT ENTFERNT (stützen den "anonym absenden -> Konto erstellen ->
-- verknüpfen"-Flow). Erst schließbar, wenn das VERKNÜPFEN ebenfalls über eine
-- Edge-Function läuft (nächster Baustein):
--   • customers  SELECT customers_select_own   ("created_at > now()-1min OR user_id=sub")  <- 60-Sek-PII-Fenster
--   • customers  UPDATE claim_fresh_customer   (10-Min fresh-claim)
--   • material_requests UPDATE update_fresh_requests (10-Min fresh-claim)
-- Danach würde man zusätzlich ausführen:
--   drop policy if exists claim_fresh_customer on public.customers;
--   drop policy if exists update_fresh_requests on public.material_requests;
--   drop policy if exists customers_select_own on public.customers;
--   create policy customers_select_own on public.customers for select
--     using (user_id = (auth.jwt() ->> 'sub'));
-- ============================================================================

-- WIEDERHERSTELLEN (falls doch benötigt):
--   create policy customers_insert_public on public.customers for insert with check (true);
--   create policy material_requests_insert_public on public.material_requests for insert with check (true);
--   create policy special_requests_insert_public on public.special_requests for insert with check (true);

-- Kontrolle danach:
-- select tablename, cmd, policyname from pg_policies where schemaname='public' order by tablename, cmd;
