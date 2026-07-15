-- Fix existing material_requests: map old liefer_zone values (PLZ prefixes /
-- canton codes) to the 10 canonical bundling regions.
--
-- ⚠️ Two variants below. Use variant B unless material_requests actually has a
-- populated `kanton` column — in this codebase the Kanton is stored on the
-- `customers` table, not on material_requests, so variant A would map almost
-- everything to the 'Zürich' fallback.

-- ─────────────────────────────────────────────────────────────
-- Variant A — as originally specified (requires material_requests.kanton):
-- ─────────────────────────────────────────────────────────────
UPDATE material_requests SET liefer_zone = CASE
  WHEN kanton = 'ZH' THEN 'Zürich'
  WHEN kanton = 'BE' THEN 'Bern'
  WHEN kanton IN ('BS','BL') THEN 'Basel'
  WHEN kanton = 'LU' THEN 'Luzern'
  WHEN kanton IN ('SG','AR','AI','TG','GR','GL','SH') THEN 'Ostschweiz'
  WHEN kanton IN ('UR','SZ','OW','NW','ZG') THEN 'Zentralschweiz'
  WHEN kanton = 'AG' THEN 'Aargau'
  WHEN kanton = 'TI' THEN 'Tessin'
  WHEN kanton IN ('VD','GE','NE','VS','FR','JU') THEN 'Westschweiz'
  WHEN kanton = 'SO' THEN 'Aargau'
  ELSE 'Zürich'
END
WHERE liefer_zone NOT IN ('Zürich','Bern','Basel','Luzern','Ostschweiz','Zentralschweiz','Aargau','Tessin','Westschweiz','Ganze Schweiz');

-- ─────────────────────────────────────────────────────────────
-- Variant B (recommended) — derive the region from the linked customer's kanton:
-- ─────────────────────────────────────────────────────────────
UPDATE material_requests mr SET liefer_zone = CASE
  WHEN c.kanton = 'ZH' THEN 'Zürich'
  WHEN c.kanton = 'BE' THEN 'Bern'
  WHEN c.kanton IN ('BS','BL') THEN 'Basel'
  WHEN c.kanton = 'LU' THEN 'Luzern'
  WHEN c.kanton IN ('SG','AR','AI','TG','GR','GL','SH') THEN 'Ostschweiz'
  WHEN c.kanton IN ('UR','SZ','OW','NW','ZG') THEN 'Zentralschweiz'
  WHEN c.kanton = 'AG' THEN 'Aargau'
  WHEN c.kanton = 'TI' THEN 'Tessin'
  WHEN c.kanton IN ('VD','GE','NE','VS','FR','JU') THEN 'Westschweiz'
  WHEN c.kanton = 'SO' THEN 'Aargau'
  ELSE 'Zürich'
END
FROM customers c
WHERE mr.customer_id = c.id
  AND mr.liefer_zone NOT IN ('Zürich','Bern','Basel','Luzern','Ostschweiz','Zentralschweiz','Aargau','Tessin','Westschweiz','Ganze Schweiz');
