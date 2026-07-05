# Auto-Bundle Edge Function — Deployment Guide

## What it does

Groups open material requests (`status = 'offen'`, `bundle_id = null`) by:
- Same `sourceon_id` (material type)
- Same `liefer_zone` (exact match)
- Overlapping delivery windows (≥3 days overlap)

Publishes a bundle when the EARLIEST `collection_end` among its requests is reached
(window-based timing driven by each customer's `liefer_zeitraum_von`), not immediately
at 50k. Groups keep collecting partners until then — large ≥50k orders wait too.
- `bid_deadline_days`: 7 (≥16 days lead), 5 (12–15), 3 (9–11), 2 (<9) — set from the
  MOST URGENT request so the auction finishes in time for every member.
- `collection_end = liefer_zeitraum_von − (bid_deadline_days + 2)`, capped at
  `created_at + 14 days`.
- ≥50k → normal bundle with volume-based discount tier (7%–28%); <50k at collection_end
  → fallback bundle (7%, `is_fallback_bundle = true`).

⚠️ These timing formulas MUST stay in sync with `/timing.js` (customer dashboard) and
the tempo indicator in `kontakt.html`.

## Option A: Deploy via Supabase CLI

```bash
# 1. Install CLI (if not installed)
npm install -g supabase

# 2. Login
supabase login

# 3. Link to your project (find ref in Supabase Dashboard → Settings → General)
supabase link --project-ref mttzsqtuaisdjisjxrey

# 4. Deploy the function
supabase functions deploy auto-bundle --no-verify-jwt
```

The `--no-verify-jwt` flag allows calling without a Bearer token (needed for pg_cron).

## Option B: Deploy via Supabase Dashboard

1. Go to https://supabase.com/dashboard → your project → **Edge Functions**
2. Click **Create a new function**
3. Name it `auto-bundle`
4. Paste the contents of `index.ts`
5. Under settings, disable **JWT verification** (so pg_cron can call it)
6. Click **Deploy**

## Testing manually

```bash
# Replace with your actual function URL and anon key
curl -X POST \
  https://mttzsqtuaisdjisjxrey.supabase.co/functions/v1/auto-bundle \
  -H "Authorization: Bearer YOUR_SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json"
```

Or simply open the URL in a browser if JWT is disabled.

## Setting up hourly cron job

Run this SQL in Supabase Dashboard → SQL Editor:

```sql
-- Enable pg_cron and pg_net if not already enabled
-- (go to Database → Extensions and enable both first)

-- Create the hourly cron job
SELECT cron.schedule(
  'auto-bundle-hourly',           -- job name
  '0 * * * *',                    -- every hour at minute 0
  $$
  SELECT net.http_post(
    url := 'https://mttzsqtuaisdjisjxrey.supabase.co/functions/v1/auto-bundle',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
```

If `current_setting('app.settings.service_role_key')` is not configured, use the
literal service role key instead (find it in Dashboard → Settings → API):

```sql
SELECT cron.schedule(
  'auto-bundle-hourly',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://mttzsqtuaisdjisjxrey.supabase.co/functions/v1/auto-bundle',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
```

### Managing the cron job

```sql
-- List all cron jobs
SELECT * FROM cron.job;

-- Unschedule
SELECT cron.unschedule('auto-bundle-hourly');

-- Check recent runs
SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;
```

## Required extensions

Enable these in Supabase Dashboard → Database → Extensions:
- **pg_cron** — for scheduled execution
- **pg_net** — for HTTP calls from SQL (used by cron to call the Edge Function)
