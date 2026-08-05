-- Feld fuer die Provisions-Nachverfolgung (Admin markiert bezahlte Provisionen).
-- Idempotent.
alter table public.bundles add column if not exists provision_collected boolean default false;
