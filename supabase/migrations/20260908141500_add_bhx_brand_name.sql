alter table public.getlink_source_product_identity
  add column if not exists bhx_brand_name text not null default '';

with bhx_brand_counts as (
  select
    lower(regexp_replace(brand, '[^[:alnum:]]', '', 'g')) as brand_key,
    brand,
    count(*) as n
  from public.getlink_source_product_identity
  where source_name='Bách Hóa XANH'
    and coalesce(brand,'')<>''
  group by 1,2
),
bhx_brand_choice as (
  select distinct on (brand_key)
    brand_key, brand
  from bhx_brand_counts
  where brand_key<>''
  order by brand_key, n desc, brand
)
update public.getlink_source_product_identity i
set bhx_brand_name=b.brand,
    updated_at=now()
from bhx_brand_choice b
where i.source_name='WinMart'
  and lower(regexp_replace(i.brand, '[^[:alnum:]]', '', 'g'))=b.brand_key
  and coalesce(i.bhx_brand_name,'') is distinct from b.brand;
