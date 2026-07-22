# admin-data Edge Function — Deployment Guide

## What it does

Server-side admin API for `adminoverview.html`. Holds the Supabase
**service_role key server-side** (never in the browser) and exposes only a fixed
set of admin actions, gated by a shared-secret header.

- Auth: request must send header `x-admin-secret: <ADMIN_SECRET>`.
- Actions (POST JSON body `{ "action": "..." }`):
  - Reads: `stats`, `pending_suppliers`, `all_suppliers`, `all_customers`,
    `all_bundles`, `expired_bundles`
  - Writes: `verify_supplier` `{id}`, `reject_supplier` `{id}`,
    `republish_bundle` `{id, ziel_mindestrabatt?, bid_deadline?}`,
    `remove_bundle` `{id}`

## Deploy

```bash
# 1. Set the shared secret (choose a long random string)
supabase secrets set ADMIN_SECRET="<long-random-string>"

# 2. Deploy the function
supabase link --project-ref mttzsqtuaisdjisjxrey   # if not linked yet
supabase functions deploy admin-data --no-verify-jwt
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically — do
NOT set them manually.

## Then in adminoverview.html

Set `ADMIN_SECRET` in the page to the **same** value you used above. That secret
can only invoke this function (not the whole database), so exposing it in the
gated admin page is acceptable — unlike the service_role key, which must never
be shipped to the browser.

## Rotating the secret

Change it in both places (Supabase secret + the page) at the same time:
```bash
supabase secrets set ADMIN_SECRET="<new-value>"
```
