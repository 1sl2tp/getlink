-- Stable supplier product identity.
-- Product code is the primary identity; source row is only the current XLS position.
-- Reserved codes live in XLS so new rows can be added without generating identity from row order.

alter table public.getlink_supplier_products
  add column if not exists product_code text,
  add column if not exists is_active boolean not null default true,
  add column if not exists deleted_at timestamptz;

update public.getlink_supplier_products
set product_code = case source_key
  when 'hang-u' then 'HU-' || lpad((source_row-1)::text,6,'0')
  when 'thuoc-la' then 'TL-' || lpad((source_row-1)::text,6,'0')
  when 'sua' then 'SUA-' || lpad((source_row-1)::text,6,'0')
  when 'hang-thuong' then 'HT-' || lpad((source_row-1)::text,6,'0')
  when 'masan' then 'MAS-' || lpad((source_row-1)::text,6,'0')
  else upper(regexp_replace(source_key,'[^a-zA-Z0-9]','','g')) || '-' || lpad((source_row-1)::text,6,'0')
end
where product_code is null or product_code='';

update public.getlink_supplier_products
set product_name = upper(left(product_name,1)) || substring(product_name from 2)
where product_name is not null and product_name <> '';

alter table public.getlink_supplier_price_history
  add column if not exists product_code text;

update public.getlink_supplier_price_history h
set product_code=p.product_code,
    product_name=upper(left(h.product_name,1)) || substring(h.product_name from 2)
from public.getlink_supplier_products p
where h.source_key=p.source_key
  and h.source_row=p.source_row
  and (h.product_code is null or h.product_code='');

create temp table supplier_url_map on commit drop as
select product_code, canonical_url as old_url,
       'https://get.taphoa.xyz/nguon-hang/' || source_key || '/' || product_code as new_url
from public.getlink_supplier_products;

update public.getlink_supplier_products p
set canonical_url=m.new_url
from supplier_url_map m
where p.product_code=m.product_code
  and p.canonical_url<>m.new_url;

update public.getlink_supplier_price_history h
set canonical_url=m.new_url
from supplier_url_map m
where h.canonical_url=m.old_url;

alter table public.getlink_supplier_products
  alter column product_code set not null;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname='getlink_supplier_products_pkey'
      and conrelid='public.getlink_supplier_products'::regclass
  ) then
    alter table public.getlink_supplier_products
      drop constraint getlink_supplier_products_pkey;
  end if;
end $$;

alter table public.getlink_supplier_products
  add constraint getlink_supplier_products_pkey primary key (product_code);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='getlink_supplier_products_source_row_key'
      and conrelid='public.getlink_supplier_products'::regclass
  ) then
    alter table public.getlink_supplier_products
      add constraint getlink_supplier_products_source_row_key unique (source_key,source_row);
  end if;
end $$;

create index if not exists getlink_supplier_products_active_idx
  on public.getlink_supplier_products (source_key,is_active,source_row);

create index if not exists getlink_supplier_price_history_product_code_idx
  on public.getlink_supplier_price_history (product_code,detected_at desc);

create or replace function public.getlink_log_supplier_price_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op='INSERT' then
    if new.input_price_vnd is not null and new.input_price_vnd > 0 then
      insert into public.getlink_supplier_price_history(
        source_key,source_row,product_code,canonical_url,product_name,
        old_price_vnd,new_price_vnd,delta_vnd,direction,detected_at
      ) values (
        new.source_key,new.source_row,new.product_code,new.canonical_url,new.product_name,
        null,new.input_price_vnd,null,'initial',
        coalesce(new.imported_at,now())
      );
    end if;
  elsif new.input_price_vnd is distinct from old.input_price_vnd
    and new.input_price_vnd is not null and new.input_price_vnd > 0
    and old.input_price_vnd is not null and old.input_price_vnd > 0 then
    insert into public.getlink_supplier_price_history(
      source_key,source_row,product_code,canonical_url,product_name,
      old_price_vnd,new_price_vnd,delta_vnd,direction,detected_at
    ) values (
      new.source_key,new.source_row,new.product_code,new.canonical_url,new.product_name,
      old.input_price_vnd,new.input_price_vnd,
      new.input_price_vnd-old.input_price_vnd,
      case when new.input_price_vnd>old.input_price_vnd then 'up' else 'down' end,
      now()
    );
  end if;
  return null;
end;
$$;
