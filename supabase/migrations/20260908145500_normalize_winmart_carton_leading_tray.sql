with parsed as (
  select
    l.canonical_url,
    (regexp_match(l.name, '^(Khay|Vỉ)[[:space:]]+([0-9]+)[[:space:]]+(chai|lon|hộp|gói|túi|bịch|hũ|lọ|can|ly|tô|bình)([[:space:]]|$)', 'i'))[2]::int as qty,
    lower((regexp_match(l.name, '^(Khay|Vỉ)[[:space:]]+([0-9]+)[[:space:]]+(chai|lon|hộp|gói|túi|bịch|hũ|lọ|can|ly|tô|bình)([[:space:]]|$)', 'i'))[3]) as unit_key
  from public.getlink_links l
  where l.source='WinMart'
    and l.link_type='product'
    and lower(coalesce(l.packaging,''))='thùng'
    and l.name ~* '^(Khay|Vỉ)[[:space:]]+[0-9]+[[:space:]]+(chai|lon|hộp|gói|túi|bịch|hũ|lọ|can|ly|tô|bình)([[:space:]]|$)'
)
update public.getlink_link_pack_hierarchy h
set label1='Thùng',
    qty1=1,
    label2='',
    qty2=0,
    label3=case p.unit_key
      when 'chai' then 'Chai'
      when 'lon' then 'Lon'
      when 'hộp' then 'Hộp'
      when 'gói' then 'Gói'
      when 'túi' then 'Túi'
      when 'bịch' then 'Bịch'
      when 'hũ' then 'Hũ'
      when 'lọ' then 'Lọ'
      when 'can' then 'Can'
      when 'ly' then 'Ly'
      when 'tô' then 'Tô'
      when 'bình' then 'Bình'
    end,
    qty3=p.qty,
    evidence='source',
    updated_at=now()
from parsed p
where h.link_url=p.canonical_url;

with parsed as (
  select
    l.canonical_url,
    (regexp_match(l.name, '^(Khay|Vỉ)[[:space:]]+([0-9]+)[[:space:]]+(chai|lon|hộp|gói|túi|bịch|hũ|lọ|can|ly|tô|bình)([[:space:]]|$)', 'i'))[2]::int as qty
  from public.getlink_links l
  where l.source='WinMart'
    and l.link_type='product'
    and lower(coalesce(l.packaging,''))='thùng'
    and l.name ~* '^(Khay|Vỉ)[[:space:]]+[0-9]+[[:space:]]+(chai|lon|hộp|gói|túi|bịch|hũ|lọ|can|ly|tô|bình)([[:space:]]|$)'
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
