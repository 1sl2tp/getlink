
create table if not exists public.getlink_supplier_pair_state (
  source_key text not null,
  product_code text not null,
  ncc_name text,
  ncc_price_sheet numeric,
  manager_name text,
  manager_price_sheet numeric,
  resolved_name text,
  resolved_price_sheet numeric,
  synced_at timestamptz not null default now(),
  primary key (source_key, product_code)
);

alter table public.getlink_supplier_pair_state enable row level security;

revoke all on public.getlink_supplier_pair_state from anon, authenticated;
grant all on public.getlink_supplier_pair_state to service_role;
