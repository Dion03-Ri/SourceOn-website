# Resolve Expired Bundles — Deployment Guide

## What it does

Finds bundles where `status = 'ausgeschrieben'` and `bid_deadline` has passed:
- **Has qualifying bids** (rabatt_prozent >= ziel_mindestrabatt): awards to highest bidder, marks others as lost, updates material_requests to 'vergeben'
- **No qualifying bids**: marks bundle as 'abgelaufen', bids as 'verloren', leaves material_requests for admin decision

## Deploy

### Via Supabase CLI

```bash
supabase functions deploy resolve-expired-bundles --no-verify-jwt
```

### Via Dashboard

1. Edge Functions → Create → name: `resolve-expired-bundles`
2. Paste `index.ts`, disable JWT verification, Deploy

## Cron job (runs hourly alongside auto-bundle)

Die Function verifiziert intern den Header `x-ai-secret` gegen das Function-
Secret `AI_TRIGGER_SECRET` (gleiches Muster wie ai-supplier-check). Der Cron-Job
MUSS diesen Header mitschicken, sonst antwortet die Function mit 401. Verify JWT
ist AUS — ein `Authorization`-Bearer wird nicht mehr benoetigt.

`<AI_TRIGGER_SECRET>` unten durch den echten Wert des Function-Secrets ersetzen.

```sql
-- vorhandenen Job zuerst entfernen (falls schon geplant)
SELECT cron.unschedule('resolve-expired-hourly');

SELECT cron.schedule(
  'resolve-expired-hourly',
  '5 * * * *',  -- every hour at minute 5 (offset from auto-bundle at minute 0)
  $$
  SELECT net.http_post(
    url := 'https://mttzsqtuaisdjisjxrey.supabase.co/functions/v1/resolve-expired-bundles',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-ai-secret', '<AI_TRIGGER_SECRET>'
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
```

## Required DB columns

```sql
ALTER TABLE bundles ADD COLUMN IF NOT EXISTS gewonnener_supplier_id TEXT;
ALTER TABLE bundles ADD COLUMN IF NOT EXISTS finaler_rabatt NUMERIC;
```
