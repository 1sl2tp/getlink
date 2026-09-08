with parsed as (
  select
    l.canonical_url,
    (regexp_match(l.name, '^Thùng\s+(\d+)\s+(ly|tô|bình)\b', 'i'))[1]::int as qty,
    lower((regexp_match(l.name, '^Thùng\s+(\d+)\s+(ly|tô|bình)\b', 'i'))[2]) as unit_key
  from public.getlink_links l
  join public.getlink_link_pack_hierarchy h on h.link_url=l.canonical_url
  where l.source='Bách Hóa XANH'
    and l.link_type='product'
    and h.label1='Thùng'
    and coalesce(h.label2,'')=''
    and coalesce(h.label3,'')=''
    and l.name ~* '^Thùng\s+\d+\s+(ly|tô|bình)\b'
)
update public.getlink_link_pack_hierarchy h
set label1='Thùng',
    qty1=1,
    label3=case p.unit_key when 'ly' then 'Ly' when 'tô' then 'Tô' when 'bình' then 'Bình' end,
    qty3=p.qty,
    evidence='source',
    updated_at=now()
from parsed p
where h.link_url=p.canonical_url;

with parsed as (
  select
    l.canonical_url,
    (regexp_match(l.name, '^Thùng\s+(\d+)\s+(ly|tô|bình)\b', 'i'))[1]::int as qty
  from public.getlink_links l
  where l.source='Bách Hóa XANH'
    and l.link_type='product'
    and l.name ~* '^Thùng\s+\d+\s+(ly|tô|bình)\b'
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
