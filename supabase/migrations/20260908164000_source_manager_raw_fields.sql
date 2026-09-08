-- Preserve source-provided brand/group labels for source management.
-- Canonical fields may change; raw_* fields remain the source audit trail.

alter table public.getlink_source_product_identity
  add column if not exists raw_brand text,
  add column if not exists raw_category text;

with latest_snapshot as (
  select distinct on (l.canonical_url)
    l.canonical_url,
    nullif(btrim(s.result_json #>> '{source_identity,brand}'),'') as snapshot_brand,
    nullif(btrim(s.result_json #>> '{source_identity,category}'),'') as snapshot_category
  from public.getlink_links l
  join public.getlink_price_snapshots s on s.link_id=l.id
  where l.link_type='product'
  order by l.canonical_url,s.checked_at desc
)
update public.getlink_source_product_identity i
set raw_brand=coalesce(i.raw_brand,ls.snapshot_brand,i.brand),
    raw_category=coalesce(i.raw_category,ls.snapshot_category,i.category),
    updated_at=now()
from latest_snapshot ls
where i.link_url=ls.canonical_url
  and (i.raw_brand is null or i.raw_category is null);

update public.getlink_source_product_identity
set raw_brand=coalesce(raw_brand,brand),
    raw_category=coalesce(raw_category,category),
    updated_at=now()
where raw_brand is null or raw_category is null;
