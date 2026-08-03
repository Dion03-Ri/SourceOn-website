-- Fix: neu registrierte Kunden konnten kein Profil anlegen.
-- Der Lockdown (rls_lockdown.sql) hat die einzige Insert-Policy auf customers
-- entfernt (customers_insert_public, gegen das anonyme PII-Fenster). Dadurch
-- konnten AUCH eingeloggte Nutzer keine eigene Kundenzeile mehr anlegen ->
-- kein Kundenprofil -> kein Dashboard-Link.
--
-- Diese Policy erlaubt NUR eingeloggten Nutzern, ihre EIGENE Kundenzeile
-- anzulegen (user_id = ihre Clerk-ID). Kein anonymer Insert (die Anonym-
-- Formularroute laeuft weiterhin ueber die Edge-Function submit-customer-request).
-- Sicher: niemand kann eine Zeile mit fremder user_id einfuegen.

drop policy if exists customers_insert_own on public.customers;
create policy customers_insert_own on public.customers
  for insert to authenticated
  with check (user_id = (auth.jwt() ->> 'sub'));
