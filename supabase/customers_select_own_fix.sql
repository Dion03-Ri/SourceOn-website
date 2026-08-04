-- Sicherheits-Fix fuer customers_select_own (60-Sek-RueckLese-Fenster).
--
-- BUG (vorher): using (created_at > now()-1min OR user_id = sub)
--   -> das OR machte JEDE Zeile juenger als 60s fuer alle (inkl. anon) sichtbar,
--      auch bereits VERKNUEPFTE Kunden -> PII-Leak echter Kundenzeilen.
--
-- FIX: nur FRISCHE, noch UNVERKNUEPFTE Zeilen (user_id IS NULL) kurzzeitig offen
--   (fuer den "anonym absenden -> zurueckerlesen -> verknuepfen"-Flow), plus die
--   EIGENEN Zeilen des eingeloggten Nutzers. Bereits verknuepfte Kunden sind nie
--   mehr ueber das Zeitfenster sichtbar.
--
-- Rolle bleibt bewusst public (kein TO): der anonyme Absender muss seine gerade
-- erstellte Zeile zuruecklesen koennen. authenticated wuerde den anon-Flow brechen.
--
-- Vollstaendig schliessbar (Policy ganz entfernen), sobald das Verknuepfen ueber
-- eine Edge-Function laeuft (link-customer, offener Pre-Launch-Baustein).

drop policy if exists customers_select_own on public.customers;
create policy customers_select_own on public.customers
  for select
  using (
    (created_at > now() - interval '1 minute' and user_id is null)
    or user_id = (auth.jwt() ->> 'sub')
  );
