-- Canonical product merge: keep source rows immutable and attach them to one confirmed product.
create table if not exists public.getlink_canonical_products (
  id text primary key,
  canonical_name text not null,
  image_url text,
  pack_label_1 text not null default '',
  pack_qty_1 numeric not null default 0,
  pack_label_2 text not null default '',
  pack_qty_2 numeric not null default 0,
  pack_label_3 text not null default '',
  pack_qty_3 numeric not null default 0,
  name_source_url text,
  pack_source_url text,
  image_source_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.getlink_canonical_product_members (
  source_url text primary key,
  canonical_product_id text not null references public.getlink_canonical_products(id) on delete cascade,
  source_key text not null,
  added_at timestamptz not null default now()
);

create index if not exists getlink_canonical_product_members_product_idx
  on public.getlink_canonical_product_members(canonical_product_id);

alter table public.getlink_canonical_products enable row level security;
alter table public.getlink_canonical_product_members enable row level security;

-- Edge Function uses the service role. Do not expose direct browser writes.
revoke all on public.getlink_canonical_products from anon, authenticated;
revoke all on public.getlink_canonical_product_members from anon, authenticated;
