alter table public.getlink_source_product_identity
  add column if not exists bhx_match_url text not null default '',
  add column if not exists bhx_match_name text not null default '';
