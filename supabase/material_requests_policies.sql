-- material_requests — RLS-Policies (echter Live-Stand).
-- Rekonstruiert 1:1 aus pg_policies der produktiven Supabase-DB, damit das Repo
-- den tatsaechlichen Stand widerspiegelt (diese Policies waren bisher nur in
-- Kommentaren erwaehnt, aber nirgends als create-statement hinterlegt).
--
-- Zusammenfassung der Absicherung:
--   • SELECT: nur eigene Anfragen (Eigentuemer ueber customers.user_id = Clerk-sub),
--     KEIN Zeitfenster.
--   • UPDATE update_own_requests: Kunde aendert eigene Anfragen (USING + WITH CHECK).
--   • UPDATE update_fresh_requests: 10-Min-Claim-Fenster fuer den Flow
--     "anonym absenden -> Konto erstellen -> verknuepfen". KORREKT begrenzt auf
--     UNVERKNUEPFTE (user_id IS NULL) UND frische Kundenzeilen -> bereits verknuepfte
--     Anfragen sind hier NICHT erreichbar (anders als der fruehere customers-Bug).
--     Vollstaendig schliessbar (Policy entfernen), sobald das Verknuepfen ueber die
--     Edge-Function link-customer laeuft (offener Pre-Launch-Baustein).

alter table public.material_requests enable row level security;

-- SELECT: Kunde sieht nur eigene Anfragen. Rolle public, aber fuer anon nie erfuellt
-- (auth.jwt()->>'sub' ist dann NULL) -> funktional authenticated-only.
drop policy if exists material_requests_select_own_clerk on public.material_requests;
create policy material_requests_select_own_clerk on public.material_requests
  for select
  using (
    customer_id in (
      select id from public.customers
      where user_id = (auth.jwt() ->> 'sub')
    )
  );

-- UPDATE (eigene): Kunde darf eigene Anfragen aendern (z.B. stornieren).
-- Zusaetzlich schuetzt der Trigger guard_request_status die erlaubten Status-Wechsel.
drop policy if exists update_own_requests on public.material_requests;
create policy update_own_requests on public.material_requests
  for update to authenticated
  using (
    customer_id in (
      select id from public.customers
      where user_id = (auth.jwt() ->> 'sub')
    )
  )
  with check (
    customer_id in (
      select id from public.customers
      where user_id = (auth.jwt() ->> 'sub')
    )
  );

-- UPDATE (Claim-Fenster, 10 Min): nur UNVERKNUEPFTE, frische Kundenzeilen.
-- Kein explizites WITH CHECK -> Postgres nutzt dafuer die USING-Bedingung
-- (verhindert das Umhaengen einer frischen Anfrage in ein bereits verknuepftes Konto).
drop policy if exists update_fresh_requests on public.material_requests;
create policy update_fresh_requests on public.material_requests
  for update to authenticated
  using (
    customer_id in (
      select id from public.customers
      where user_id is null
        and created_at > (now() - interval '10 minutes')
    )
  );
