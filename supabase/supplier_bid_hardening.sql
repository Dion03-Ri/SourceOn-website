-- Server-seitige Absicherung der Lieferanten-Seite (direkte RLS-Writes).
--
-- Behebt drei Luecken, bei denen Geschaeftsregeln bisher nur im Frontend
-- geprueft wurden und per direktem API-Aufruf umgangen werden konnten:
--
--   1) 🔴 Lieferant konnte sich beim ERSTEN Insert selbst verifizieren
--      (guard_supplier_status war nur BEFORE UPDATE -> feuerte beim Insert nie).
--   2) 🔴 Gebote hatten keine Wertgrenzen -> rabatt_prozent=999 gewinnt jede
--      Auktion (Zuschlag = hoechster Rabatt).
--   3) 🟡 Gebot unter dem geforderten Mindestrabatt konnte eingefuegt werden.
--
-- Idempotent: mehrfach ausfuehrbar.

-- ----------------------------------------------------------------------------
-- 1) Selbst-Verifizierung beim INSERT verhindern
--    Nicht-Service-Role darf beim Anlegen NUR status='pending' setzen.
-- ----------------------------------------------------------------------------
create or replace function public.guard_supplier_status_insert()
returns trigger language plpgsql as $$
begin
  if current_user <> 'service_role'
     and coalesce(new.status, 'pending') <> 'pending' then
    raise exception 'Neue Lieferanten starten immer mit status=pending; Verifizierung nur durch SourceOn.';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_supplier_status_insert on public.suppliers;
create trigger trg_guard_supplier_status_insert
  before insert on public.suppliers
  for each row execute function public.guard_supplier_status_insert();

-- ----------------------------------------------------------------------------
-- 2) Wertgrenzen fuer Gebote (Rabatt 0-100 %, Preis nicht negativ)
--    Als CHECK-Constraints — gelten fuer JEDEN Insert/Update, auch Service-Role.
-- ----------------------------------------------------------------------------
alter table public.bids
  drop constraint if exists bids_rabatt_prozent_range;
alter table public.bids
  add constraint bids_rabatt_prozent_range
  check (rabatt_prozent is null or (rabatt_prozent >= 0 and rabatt_prozent <= 100));

alter table public.bids
  drop constraint if exists bids_preis_nonneg;
alter table public.bids
  add constraint bids_preis_nonneg
  check (preis_pro_einheit is null or preis_pro_einheit >= 0);

-- ----------------------------------------------------------------------------
-- 3) Gebot muss den Mindestrabatt des Bundles erreichen (BEFORE INSERT)
--    Nicht-Service-Role kann kein Gebot unter ziel_mindestrabatt einfuegen.
--    Service-Role (Auswertung/Migration) bleibt ausgenommen.
-- ----------------------------------------------------------------------------
create or replace function public.guard_bid_min_discount()
returns trigger language plpgsql as $$
declare
  ziel_raw numeric;
  ziel_pct numeric;
begin
  if current_user = 'service_role' then
    return new;
  end if;
  select b.ziel_mindestrabatt into ziel_raw
    from public.bundles b where b.id = new.bundle_id;
  if ziel_raw is not null and new.rabatt_prozent is not null then
    -- Skala-agnostisch — identische Normalisierung wie resolve-expired-bundles:
    -- Bruch (0.16) wird zu Prozent (16), bereits-Prozent bleibt unveraendert.
    ziel_pct := case when ziel_raw < 1 then ziel_raw * 100 else ziel_raw end;
    if new.rabatt_prozent < ziel_pct then
      raise exception 'Gebot % liegt unter dem geforderten Mindestrabatt %',
        new.rabatt_prozent, round(ziel_pct, 2);
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_bid_min_discount on public.bids;
create trigger trg_guard_bid_min_discount
  before insert on public.bids
  for each row execute function public.guard_bid_min_discount();
