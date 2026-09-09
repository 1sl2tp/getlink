-- Learn a confirmed canonical identity from selected source rows.
alter table public.getlink_canonical_products
  add column if not exists canonical_brand text not null default '',
  add column if not exists size_value numeric,
  add column if not exists size_unit text not null default '',
  add column if not exists primary_code text not null default '',
  add column if not exists primary_code_kind text not null default '',
  add column if not exists identity_source_url text;
