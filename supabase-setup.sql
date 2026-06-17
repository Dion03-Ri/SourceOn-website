-- ============================================================
-- SourceOn Supplier Portal — Supabase SQL Setup
-- Run this in the Supabase SQL Editor (supabase.com → SQL Editor)
-- ============================================================

-- 1. SUPPLIERS TABLE
create table if not exists public.suppliers (
  id uuid primary key references auth.users(id) on delete cascade,
  company_name text not null,
  contact_person text not null,
  email text not null,
  phone text not null,
  website text,
  materials text[] default '{}',
  regions text[] default '{}',
  annual_capacity text,
  certifications text[] default '{}',
  notes text,
  status text not null default 'pending' check (status in ('pending', 'verified', 'rejected')),
  created_at timestamptz default now()
);

-- 2. BUNDLES TABLE
create table if not exists public.bundles (
  id uuid primary key default gen_random_uuid(),
  material_type text not null,
  total_quantity text not null,
  unit text not null,
  delivery_zone text not null,
  delivery_timeframe text not null,
  number_of_sites integer not null default 1,
  special_requirements text,
  status text not null default 'open' check (status in ('open', 'awarded', 'closed')),
  created_at timestamptz default now(),
  bid_deadline timestamptz not null
);

-- 3. BIDS TABLE
create table if not exists public.bids (
  id uuid primary key default gen_random_uuid(),
  bundle_id uuid not null references public.bundles(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  price_per_unit numeric not null,
  total_price numeric not null,
  delivery_capability_notes text,
  submitted_at timestamptz default now(),
  status text not null default 'submitted' check (status in ('submitted', 'won', 'lost')),
  unique(bundle_id, supplier_id)
);

-- 4. ENABLE ROW LEVEL SECURITY
alter table public.suppliers enable row level security;
alter table public.bundles enable row level security;
alter table public.bids enable row level security;

-- 5. RLS POLICIES — SUPPLIERS
-- Suppliers can only read their own row
create policy "Suppliers can read own profile"
  on public.suppliers for select
  using (auth.uid() = id);

-- Suppliers can update their own row
create policy "Suppliers can update own profile"
  on public.suppliers for update
  using (auth.uid() = id);

-- Allow insert during signup (the user just got created via auth)
create policy "Allow insert own supplier profile"
  on public.suppliers for insert
  with check (auth.uid() = id);

-- 6. RLS POLICIES — BUNDLES
-- Any verified supplier can read open bundles
create policy "Verified suppliers can read open bundles"
  on public.bundles for select
  using (
    exists (
      select 1 from public.suppliers
      where suppliers.id = auth.uid()
      and suppliers.status = 'verified'
    )
  );

-- 7. RLS POLICIES — BIDS
-- Suppliers can only insert their own bids
create policy "Suppliers can insert own bids"
  on public.bids for insert
  with check (auth.uid() = supplier_id);

-- Suppliers can only read their own bids (CRITICAL: sealed-bid system)
create policy "Suppliers can read only own bids"
  on public.bids for select
  using (auth.uid() = supplier_id);

-- ============================================================
-- DONE. After running this:
-- 1. Go to Authentication → Settings → enable email/password signup
-- 2. To verify a supplier: go to Table Editor → suppliers → change status to 'verified'
-- 3. To create test bundles: insert rows into the bundles table directly
-- ============================================================
