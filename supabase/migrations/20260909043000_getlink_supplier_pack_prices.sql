alter table public.getlink_supplier_products
  add column if not exists carton_price_vnd bigint,
  add column if not exists retail_price_vnd bigint,
  add column if not exists retail_packaging text not null default '',
  add column if not exists primary_packaging text not null default '';

update public.getlink_supplier_products
set
  carton_price_vnd = coalesce(carton_price_vnd, display_price_vnd),
  primary_packaging = case
    when source_key='thuoc-la' then '1 cây'
    else 'Thùng'
  end
where coalesce(primary_packaging,'')='' or carton_price_vnd is null;
