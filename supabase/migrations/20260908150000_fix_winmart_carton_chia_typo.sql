with parsed as (
  select
    l.canonical_url,
    (regexp_match(lower(l.name), '(^|[[:space:]])(?:thùng|khay|vỉ)[[:space:]]+([0-9]+)[[:space:]]+chia([[:space:]]|$)', 'i'))[2]::int as qty
  from public.getlink_links l
  join public.getlink_link_pack_hierarchy h on h.link_url=l.canonical_url
  where l.source='WinMart'
    and l.link_type='product'
    and lower(coalesce(l.packaging,''))='thùng'
    and coalesce(h.label3,'')=''
    and lower(l.name) ~ '(^|[[:space:]])(thùng|khay|vỉ)[[:space:]]+[0-9]+[[:space:]]+chia([[:space:]]|$)'
)
update public.getlink_link_pack_hierarchy h
set label1='Thùng',
    qty1=1,
    label2='',
    qty2=0,
    label3='Chai',
    qty3=p.qty,
    evidence='source',
    updated_at=now()
from parsed p
where h.link_url=p.canonical_url;

with parsed as (
  select
    l.canonical_url,
    (regexp_match(lower(l.name), '(^|[[:space:]])(?:thùng|khay|vỉ)[[:space:]]+([0-9]+)[[:space:]]+chia([[:space:]]|$)', 'i'))[2]::int as qty
  from public.getlink_links l
  where l.source='WinMart'
    and l.link_type='product'
    and lower(coalesce(l.packaging,''))='thùng'
    and lower(l.name) ~ '(^|[[:space:]])(thùng|khay|vỉ)[[:space:]]+[0-9]+[[:space:]]+chia([[:space:]]|$)'
)
update public.getlink_link_comparison c
set pack_kind='carton',
    pack_quantity=p.qty,
    pack_unit='Thùng',
    regular_unit_price=case
      when coalesce(l.current_price,0)>0 and p.qty>0 then l.current_price/p.qty
      else c.regular_unit_price
    end,
    updated_at=now()
from parsed p
join public.getlink_links l on l.canonical_url=p.canonical_url
where c.link_url=p.canonical_url;
