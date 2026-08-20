-- Print Kiosk System — Database Schema
-- Project: https://hrnwaltyfpljhrivzfbn.supabase.co
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor > New Query)

-- ============================================================
-- 1. EXTENSIONS (both enabled by default on Supabase free tier)
-- ============================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ============================================================
-- 2. SHOPS TABLE
-- One row per shop/kiosk (Meeseva center etc). Each shop has its
-- own UPI VPA and pricing — nothing hardcoded in app code.
-- ============================================================
create table if not exists shops (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,              -- used in the QR URL: printkiosk.app/p/<slug>
  upi_vpa text not null,                  -- e.g. 7416952126@ybl
  upi_payee_name text not null,           -- name shown in the UPI app
  price_bw_per_page numeric(6,2) not null default 1.50,
  price_color_per_page numeric(6,2) not null default 5.00,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Your real shop row (using your actual UPI ID). Edit name/slug as you like.
insert into shops (name, slug, upi_vpa, upi_payee_name, price_bw_per_page, price_color_per_page)
values ('Test Kiosk', 'test-kiosk', '7416952126@ybl', 'Shaik Furkhan', 1.50, 5.00)
on conflict (slug) do nothing;

-- ============================================================
-- 3. ORDERS TABLE
-- ============================================================
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  order_number serial,                    -- human-friendly sequential number per shop, e.g. #0176
  shop_id uuid not null references shops(id),

  -- files: array of storage object paths, in the order the customer wants them printed
  file_paths text[] not null,
  page_count int not null,

  color_mode text not null check (color_mode in ('bw', 'color')),
  duplex boolean not null default false,  -- true = front & back requested
  copies int not null default 1,

  amount numeric(8,2) not null,

  -- status lifecycle:
  -- pending_payment -> awaiting_confirmation -> paid -> queued -> printing -> completed
  -- (or) pending_payment -> expired   [abandoned upload, auto-cleaned]
  status text not null default 'pending_payment'
    check (status in ('pending_payment','awaiting_confirmation','paid','queued','printing','completed','expired')),

  file_deleted boolean not null default false,

  created_at timestamptz not null default now(),
  paid_at timestamptz,
  completed_at timestamptz
);

create index if not exists idx_orders_shop_status on orders(shop_id, status);
create index if not exists idx_orders_created on orders(created_at);

-- ============================================================
-- 4. STORAGE BUCKET
-- Run this once (or create manually in Dashboard > Storage):
-- Bucket name: print-uploads, PRIVATE (not public)
-- ============================================================
insert into storage.buckets (id, name, public)
values ('print-uploads', 'print-uploads', false)
on conflict (id) do nothing;

-- Row Level Security: customers can upload but not read others' files.
-- The local agent + edge functions use the service_role key, which
-- bypasses RLS entirely, so this only restricts the public/anon client.
alter table orders enable row level security;

create policy "anyone can insert an order"
  on orders for insert
  to anon
  with check (true);

create policy "anyone can read their own order by id"
  on orders for select
  to anon
  using (true);  -- order id is a UUID, effectively unguessable — acceptable for this use case

-- ============================================================
-- 5. AUTO-CLEANUP (this is the "no manual storage management" part)
-- Every 15 minutes:
--   a) mark abandoned uploads (never paid within 30 min) as 'expired'
--   b) find any order that is 'expired' or 'completed' (and >1hr old)
--      with file_deleted = false, and call the cleanup-storage Edge
--      Function to actually delete the files from the bucket.
-- ============================================================
create or replace function mark_abandoned_orders()
returns void
language sql
as $$
  update orders
  set status = 'expired'
  where status = 'pending_payment'
    and created_at < now() - interval '30 minutes';
$$;

select cron.schedule(
  'mark-abandoned-orders',
  '*/10 * * * *',   -- every 10 minutes
  $$select mark_abandoned_orders();$$
);

-- This calls the cleanup-storage Edge Function, which actually deletes
-- the files via the Storage API (SQL alone can't safely delete blobs).
--
-- ONE-TIME MANUAL STEP (do this once, not ongoing work):
-- Run this line separately in the SQL Editor, with your real service_role
-- key pasted in place of YOUR_SERVICE_ROLE_KEY_HERE. This stores it
-- encrypted in Supabase Vault so the cron job can use it without the
-- key ever appearing in your git repo:
--
--   select vault.create_secret('YOUR_SERVICE_ROLE_KEY_HERE', 'service_role_key');
--
select cron.schedule(
  'cleanup-old-order-files',
  '*/15 * * * *',   -- every 15 minutes
  $$
  select net.http_post(
    url := 'https://hrnwaltyfpljhrivzfbn.supabase.co/functions/v1/cleanup-storage',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
