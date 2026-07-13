-- Special material requests submitted from the "Material nicht in der Liste?"
-- form on materialien.html. Public (anon) insert only.
CREATE TABLE IF NOT EXISTS special_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  firmenname TEXT NOT NULL,
  email TEXT NOT NULL,
  material_bezeichnung TEXT NOT NULL,
  menge TEXT NOT NULL,
  liefer_zeitraum_von DATE,
  liefer_zeitraum_bis DATE,
  verwendungszweck TEXT,
  bemerkungen TEXT,
  status TEXT DEFAULT 'offen',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- If the table already exists from an earlier run, add the newer columns:
ALTER TABLE special_requests ADD COLUMN IF NOT EXISTS bemerkungen TEXT;
ALTER TABLE special_requests ADD COLUMN IF NOT EXISTS liefer_zeitraum_bis DATE;

ALTER TABLE special_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "special_requests_insert_public" ON special_requests FOR INSERT WITH CHECK (true);
