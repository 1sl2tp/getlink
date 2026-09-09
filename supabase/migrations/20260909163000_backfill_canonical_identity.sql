-- Backfill canonical identity for groups created before identity learning existed.
with ranked as (
  select
    m.canonical_product_id,
    i.link_url,
    coalesce(nullif(i.brand,''),nullif(i.raw_brand,''),'') as brand,
    i.size_value,
    coalesce(i.size_unit,'') as size_unit,
    coalesce(nullif(i.barcode,''),nullif(i.sku,''),nullif(i.source_code,''),'') as primary_code,
    case
      when coalesce(i.barcode,'')<>'' then 'barcode'
      when coalesce(i.sku,'')<>'' then 'sku'
      when coalesce(i.source_code,'')<>'' then 'source_code'
      else ''
    end as primary_code_kind,
    row_number() over (
      partition by m.canonical_product_id
      order by
        case when coalesce(i.barcode,'')<>'' then 0 when coalesce(i.sku,'')<>'' then 1 else 2 end,
        case when i.size_value is not null and coalesce(i.size_unit,'')<>'' then 0 else 1 end,
        case when coalesce(i.brand,i.raw_brand,'')<>'' then 0 else 1 end,
        m.added_at
    ) as rn
  from public.getlink_canonical_product_members m
  join public.getlink_source_product_identity i on i.link_url=m.source_url
),
best as (
  select * from ranked where rn=1
)
update public.getlink_canonical_products p
set
  canonical_brand=case when p.canonical_brand='' then best.brand else p.canonical_brand end,
  size_value=coalesce(p.size_value,best.size_value),
  size_unit=case when p.size_unit='' then best.size_unit else p.size_unit end,
  primary_code=case when p.primary_code='' then best.primary_code else p.primary_code end,
  primary_code_kind=case when p.primary_code_kind='' then best.primary_code_kind else p.primary_code_kind end,
  identity_source_url=coalesce(p.identity_source_url,best.link_url),
  updated_at=now()
from best
where best.canonical_product_id=p.id;
