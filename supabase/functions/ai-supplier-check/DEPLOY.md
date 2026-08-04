# AI Supplier Check — Deployment Guide

## What it does

Automatically pre-screens new supplier applications using Google Gemini AI.
Evaluates plausibility (email/website match, capacity consistency, placeholder detection)
and stores an AI score (0-100), assessment text, and flags in the suppliers table.

**Does NOT change supplier status** — the admin still makes the final decision.

## Step 1: Set the Gemini API key as a Supabase secret

```bash
supabase secrets set GEMINI_API_KEY=your-gemini-api-key-here
```

Get your API key from: https://aistudio.google.com/apikey

## Step 2: Deploy the Edge Function

### Option A: Supabase CLI

```bash
supabase link --project-ref mttzsqtuaisdjisjxrey
supabase functions deploy ai-supplier-check --no-verify-jwt
```

### Option B: Supabase Dashboard

1. Go to Edge Functions in your Supabase Dashboard
2. Create a new function named `ai-supplier-check`
3. Paste the contents of `index.ts`
4. Disable JWT verification
5. Deploy

## Step 3: Set up automatic trigger on new supplier insert

### Internal auth secret

The function verifies an internal header `x-ai-secret` against the function
secret `AI_TRIGGER_SECRET`. Without it, the function is open to the internet
(it triggers paid Gemini calls). Set up:

1. Create a function secret `AI_TRIGGER_SECRET` with a long random value
   (Edge Functions → Secrets), e.g. `<DEIN_SECRET_HIER>`.
2. Put the **exact same value** into the trigger function below.

Run this SQL in Supabase Dashboard → SQL Editor:

```sql
-- Enable pg_net if not already enabled (Database → Extensions)

-- Create trigger function that calls the Edge Function.
-- The x-ai-secret value MUST match the function secret AI_TRIGGER_SECRET.
CREATE OR REPLACE FUNCTION notify_ai_supplier_check()
RETURNS trigger AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://mttzsqtuaisdjisjxrey.supabase.co/functions/v1/ai-supplier-check',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-ai-secret', '<DEIN_SECRET_HIER>'
    ),
    body := jsonb_build_object('record', jsonb_build_object('id', NEW.id))
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create the trigger
DROP TRIGGER IF EXISTS on_new_supplier_ai_check ON suppliers;
CREATE TRIGGER on_new_supplier_ai_check
  AFTER INSERT ON suppliers
  FOR EACH ROW
  EXECUTE FUNCTION notify_ai_supplier_check();
```

> Note: `ALTER DATABASE ... SET app.settings.ai_trigger_secret` fails with
> `permission denied` in the hosted SQL editor — that's why the secret is
> written as a literal in the trigger function instead of via `current_setting`.
> The trigger runs only server-side in the DB; the value is never exposed to
> the browser.

## Testing manually

```bash
curl -X POST \
  https://mttzsqtuaisdjisjxrey.supabase.co/functions/v1/ai-supplier-check \
  -H "Content-Type: application/json"
```

This will process all pending suppliers that haven't been AI-checked yet.

To check a specific supplier:

```bash
curl -X POST \
  https://mttzsqtuaisdjisjxrey.supabase.co/functions/v1/ai-supplier-check \
  -H "Content-Type: application/json" \
  -d '{"supplier_id": "the-supplier-id-here"}'
```

## Required Supabase extensions

- **pg_net** — for HTTP calls from the trigger (Database → Extensions)

## Admin display

The AI results (score, assessment, flags) are shown in adminoverview.html
in the "Wartende Lieferanten-Bewerbungen" table, with color-coded score badges:
- Green (80+): High plausibility
- Gold (50-79): Medium plausibility
- Red (<50): Low plausibility / suspicious
