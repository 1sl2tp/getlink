create table if not exists public.getlink_supplier_sources (
  source_key text primary key,
  source_name text not null,
  spreadsheet_id text not null,
  sheet_name text not null,
  sheet_gid bigint,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.getlink_supplier_products (
  source_key text not null references public.getlink_supplier_sources(source_key) on delete cascade,
  source_row integer not null check (source_row > 0),
  product_name text not null,
  input_price_vnd bigint,
  margin_thousand numeric,
  display_price_vnd bigint,
  stock_status text not null default 'no_price'
    check (stock_status in ('available','no_price','out_of_stock')),
  stock_label text not null default '',
  canonical_url text not null unique,
  raw_row jsonb not null default '[]'::jsonb,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (source_key, source_row)
);

create index if not exists getlink_supplier_products_name_idx
  on public.getlink_supplier_products (lower(product_name));
create index if not exists getlink_supplier_products_stock_idx
  on public.getlink_supplier_products (source_key, stock_status);

alter table public.getlink_supplier_sources enable row level security;
alter table public.getlink_supplier_products enable row level security;

revoke all on public.getlink_supplier_sources from anon, authenticated;
revoke all on public.getlink_supplier_products from anon, authenticated;
