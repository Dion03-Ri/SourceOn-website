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

```sql
SELECT cron.schedule(
  'resolve-expired-hourly',
  '5 * * * *',  -- every hour at minute 5 (offset from auto-bundle at minute 0)
  $$
  SELECT net.http_post(
    url := 'https://mttzsqtuaisdjisjxrey.supabase.co/functions/v1/resolve-expired-bundles',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10dHpzcXR1YWlzZGppc2p4cmV5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjI0NDcyNiwiZXhwIjoyMDk3ODIwNzI2fQ.n3xkLAcIURQ_zLyPYWwDWXHk3-rxJeMJBnq0oGooHYs"}'::jsonb,
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
