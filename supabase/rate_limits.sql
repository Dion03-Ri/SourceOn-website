-- Rate-Limiting fuer oeffentliche Edge Functions (chat, submit-*).
--
-- Atomarer Zaehler pro (bucket, identifier, Zeitfenster). Die Edge Function
-- ruft rate_limit_hit(...) vor der eigentlichen Arbeit auf; bei Ueberschreitung
-- antwortet sie mit HTTP 429. Nur der Service-Key (Edge Functions) greift auf
-- die Tabelle zu — RLS an, keine Policy => Default-Deny fuer alle anderen.
--
-- Idempotent.

create table if not exists public.rate_limits (
  bucket       text        not null,
  identifier   text        not null,   -- i.d.R. Client-IP
  window_start timestamptz not null,
  count        int         not null default 0,
  primary key (bucket, identifier, window_start)
);

alter table public.rate_limits enable row level security;
-- bewusst KEINE Policy: nur Service-Role (RLS-bypass) darf lesen/schreiben.

-- Atomar: Zaehler im aktuellen Fenster hochzaehlen und zurueckgeben, ob noch
-- im Limit. Rueckgabe true = erlaubt, false = Limit ueberschritten.
create or replace function public.rate_limit_hit(
  p_bucket text,
  p_identifier text,
  p_max int,
  p_window_seconds int
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window timestamptz;
  v_count  int;
begin
  -- Fensterbeginn auf p_window_seconds gerastert (fixed window).
  v_window := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into public.rate_limits (bucket, identifier, window_start, count)
    values (p_bucket, p_identifier, v_window, 1)
  on conflict (bucket, identifier, window_start)
    do update set count = public.rate_limits.count + 1
  returning count into v_count;

  -- alte Fenster desselben Schluessels aufraeumen (billig, begrenzt).
  delete from public.rate_limits
    where bucket = p_bucket and identifier = p_identifier and window_start < v_window;

  return v_count <= p_max;
end $$;

-- Zugriff nur fuer service_role (die Edge Functions).
revoke all on function public.rate_limit_hit(text, text, int, int) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, text, int, int) to service_role;
