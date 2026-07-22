-- ============================================================================
-- SourceOn — RLS-FIXES (im Supabase SQL Editor ausführen)
-- ============================================================================
-- Angepasst an die ECHTEN App-Flows (verifiziert im Code):
--   • Lieferant deaktiviert sich selbst   -> status = 'inactive'   (muss erlaubt bleiben)
--   • Kunde storniert / verschiebt Frist  -> status = 'storniert' + fallback_deadline
--   • Lieferant reicht ein / zieht zurück  -> status 'eingereicht' / 'zurueckgezogen'
--   • Lieferant bestätigt Lieferung        -> delivery_confirmed (Status bleibt 'gewonnen')
--   • Alle "hoheitlichen" Wechsel (verify, Zuschlag, ...) macht die Edge-Function
--     mit Service-Key -> current_user = 'service_role' -> von den Triggern ausgenommen.
--
-- Deshalb: STATUS-Schutz über BEFORE-UPDATE-Trigger (erlauben nur die legitimen
-- Übergänge), statt Spalten-Revoke (würde Deaktivierung/Storno brechen).
-- Idempotent: mehrfaches Ausführen ist sicher.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) 🔴 KRITISCH — Lieferant kann sich NICHT mehr selbst verifizieren
--    Erlaubt: eigener Datensatz + Selbst-Deaktivierung. Blockiert: jeder andere
--    Statuswechsel (v.a. -> 'verified') durch Nicht-Service-Role.
-- ----------------------------------------------------------------------------
create or replace function public.guard_supplier_status()
returns trigger language plpgsql as $$
begin
  if current_user <> 'service_role'
     and new.status is distinct from old.status
     and new.status <> 'inactive' then
    raise exception 'Lieferantenstatus darf nur durch SourceOn geändert werden (Selbst-Deaktivierung ausgenommen).';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_supplier_status on public.suppliers;
create trigger trg_guard_supplier_status
  before update on public.suppliers
  for each row execute function public.guard_supplier_status();

-- ----------------------------------------------------------------------------
-- 2) 🟠 material_requests — Kunde darf Status nur auf 'storniert' setzen
--    (andere Felder wie fallback_deadline bleiben erlaubt; Status bleibt sonst
--    unverändert für die App-Flows). Alles andere nur Service-Role.
-- ----------------------------------------------------------------------------
create or replace function public.guard_request_status()
returns trigger language plpgsql as $$
begin
  if current_user <> 'service_role'
     and new.status is distinct from old.status
     and new.status <> 'storniert' then
    raise exception 'Anfragen dürfen von Kunden nur storniert werden.';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_request_status on public.material_requests;
create trigger trg_guard_request_status
  before update on public.material_requests
  for each row execute function public.guard_request_status();

-- ----------------------------------------------------------------------------
-- 3) 🟡 bids — UPDATE-Policy fehlte komplett. Lieferant darf sein EIGENES Gebot
--    ändern; der Trigger begrenzt Statuswechsel auf 'eingereicht' (neu einreichen)
--    und 'zurueckgezogen' (zurückziehen). 'gewonnen' darf NUR bleiben (Liefer-
--    bestätigung), nicht selbst gesetzt werden (kein Selbst-Zuschlag).
-- ----------------------------------------------------------------------------
drop policy if exists bids_update_own_clerk on public.bids;
create policy bids_update_own_clerk on public.bids
  for update using  (supplier_id = (auth.jwt() ->> 'sub'))
             with check (supplier_id = (auth.jwt() ->> 'sub'));

create or replace function public.guard_bid_status()
returns trigger language plpgsql as $$
begin
  if current_user <> 'service_role'
     and new.status is distinct from old.status
     and new.status not in ('eingereicht','zurueckgezogen') then
    raise exception 'Gebotsstatus darf nur "eingereicht" oder "zurueckgezogen" gesetzt werden.';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_bid_status on public.bids;
create trigger trg_guard_bid_status
  before update on public.bids
  for each row execute function public.guard_bid_status();

-- (Optional-Härtung, NICHT aktiviert: bids INSERT zusätzlich auf verifizierte
--  Lieferanten begrenzen. Aktuelle INSERT-Policy prüft nur supplier_id = sub.
--  Bei Bedarf einkommentieren:)
-- drop policy if exists bids_insert_own_clerk on public.bids;
-- create policy bids_insert_own_clerk on public.bids for insert
--   with check (
--     supplier_id = (auth.jwt() ->> 'sub')
--     and exists (select 1 from public.suppliers s
--                 where s.id = (auth.jwt() ->> 'sub') and s.status = 'verified')
--   );

-- ----------------------------------------------------------------------------
-- 4) 🟡 commissions — Kunde darf die Provisions-/Ersparniszeilen zu SEINEN
--    eigenen Anfragen lesen (Kundendashboard nutzt kunden_ersparnis_netto).
--    Kein Insert/Update/Delete -> nur Service-Key schreibt.
--    (savings_tiers wird clientseitig NICHT gelesen -> bewusst KEINE Policy:
--     RLS an + keine Policy = nur Service-Role. Das ist korrekt.)
-- ----------------------------------------------------------------------------
alter table public.commissions enable row level security;
drop policy if exists commissions_select_own on public.commissions;
create policy commissions_select_own on public.commissions
  for select using (
    material_request_id in (
      select mr.id
        from public.material_requests mr
        join public.customers c on c.id = mr.customer_id
       where c.user_id = (auth.jwt() ->> 'sub')
    )
  );

-- ----------------------------------------------------------------------------
-- 5) Doppelte / redundante Policies entfernen (Hygiene)
--    material_catalog hatte 2× identisches public-read -> eine entfernen.
--    bundles: bundles_read_all (true) deckt alles ab -> die zweite ist überflüssig.
-- ----------------------------------------------------------------------------
drop policy if exists material_catalog_public_read on public.material_catalog;      -- Duplikat
drop policy if exists bundles_select_for_verified_suppliers_clerk on public.bundles; -- redundant zu bundles_read_all

commit;

-- ============================================================================
-- BEWUSST NICHT GEFIXT (größerer Umbau nötig — siehe Notiz):
--   • customers SELECT: "created_at > now()-1min OR user_id=sub"  (60-Sek-PII-Fenster)
--   • customers UPDATE claim_fresh_customer / material_requests update_fresh_requests
--       (10-Min "fresh claim"-Fenster)
--   -> Beide sind Workarounds für das ANONYME Einfügen+Zurücklesen der Formulare.
--      Sauberer Fix: Formular-Writes serverseitig über eine Edge-Function (Service-
--      Key) machen; dann können diese Zeitfenster ersatzlos weg und anon INSERT
--      wird komplett verboten. Separat angehen.
-- ============================================================================

-- Kontrolle nach dem Ausführen:
-- select tablename, cmd, policyname from pg_policies where schemaname='public' order by tablename, cmd;
-- select tgname, tgrelid::regclass from pg_trigger where tgname like 'trg_guard%';
