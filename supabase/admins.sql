-- Admin-Rollen sauber: Admin = Clerk-Nutzer, dessen sub in dieser Tabelle steht.
-- Geprueft wird serverseitig in der Edge-Function (admin-data/rapid-api) gegen den
-- verifizierten Clerk-Token. Kein im Browser sichtbares Shared Secret mehr.

create table if not exists public.admins (
  user_id  text primary key,            -- Clerk sub (z.B. 'user_3Ff…')
  email    text,
  added_at timestamptz default now()
);

alter table public.admins enable row level security;
-- Keine Policy => default deny fuer anon/authenticated. Nur die Edge-Function
-- (service_role) liest die Tabelle; service_role umgeht RLS.

-- Ersten Admin eintragen (deine Clerk-User-ID):
insert into public.admins (user_id, email)
values ('user_3FfTAmYooOTp87JqbDoBxlCxmax', null)
on conflict (user_id) do nothing;

-- Weitere Admins spaeter:  insert into public.admins (user_id) values ('user_...');
-- Admin entfernen:         delete from public.admins where user_id = 'user_...';
