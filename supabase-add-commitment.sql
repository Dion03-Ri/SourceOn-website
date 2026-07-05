-- ============================================================================
-- SourceOn — Verbindliche Auftragsbestätigung (Ziel-Mindestrabatt)
-- ----------------------------------------------------------------------------
-- Ergänzt material_requests um einen rechtlich nachvollziehbaren Nachweis der
-- Kundenzustimmung zum garantierten Ziel-Mindestrabatt.
-- Ausführen im Supabase-Dashboard: SQL Editor -> einfügen -> Run.
-- ============================================================================

alter table material_requests
  add column if not exists commitment_accepted boolean default false;

alter table material_requests
  add column if not exists commitment_accepted_at timestamptz;

-- Der zum Bestätigungszeitpunkt zugesagte Mindestrabatt als Dezimalzahl (z.B. 0.07 = 7%)
alter table material_requests
  add column if not exists committed_min_rabatt numeric;

-- Version der Kundenvereinbarung / des Bestätigungstextes zum Zeitpunkt der Zusage
alter table material_requests
  add column if not exists commitment_version text default 'v1.0-2026-07-04';

-- Kontrolle: neue Spalten anzeigen
select column_name, data_type, column_default
from information_schema.columns
where table_name = 'material_requests'
  and column_name in ('commitment_accepted','commitment_accepted_at','committed_min_rabatt','commitment_version')
order by column_name;
