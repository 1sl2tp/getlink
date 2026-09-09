-- Repair canonical pack metadata when a linked source has richer hierarchy than the stored canonical pack.
with ranked as (
  select
    m.canonical_product_id,
    l.canonical_url as pack_source_url,
    h.label1,
    h.qty1,
    h.label2,
    h.qty2,
    h.label3,
    h.qty3,
    (
      case when h.label1='Thùng' then 1000 else 0 end +
      case when coalesce(h.label2,'')<>'' then 180 else 0 end +
      case when coalesce(h.qty2,0)>1 then 120 else 0 end +
      case when coalesce(h.label3,'')<>'' then 180 else 0 end +
      case when coalesce(h.qty3,0)>1 then 220 else 0 end
    ) as score,
    row_number() over (
      partition by m.canonical_product_id
      order by
        (
          case when h.label1='Thùng' then 1000 else 0 end +
          case when coalesce(h.label2,'')<>'' then 180 else 0 end +
          case when coalesce(h.qty2,0)>1 then 120 else 0 end +
          case when coalesce(h.label3,'')<>'' then 180 else 0 end +
          case when coalesce(h.qty3,0)>1 then 220 else 0 end
        ) desc,
        m.added_at
    ) as rn
  from public.getlink_canonical_product_members m
  join public.getlink_links l on l.canonical_url=m.source_url
  join public.getlink_link_pack_hierarchy h on h.link_url=l.canonical_url
),
best as (
  select * from ranked where rn=1
),
current_score as (
  select
    p.id,
    (
      case when p.pack_label_1='Thùng' then 1000 else 0 end +
      case when coalesce(p.pack_label_2,'')<>'' then 180 else 0 end +
      case when coalesce(p.pack_qty_2,0)>1 then 120 else 0 end +
      case when coalesce(p.pack_label_3,'')<>'' then 180 else 0 end +
      case when coalesce(p.pack_qty_3,0)>1 then 220 else 0 end
    ) as score
  from public.getlink_canonical_products p
)
update public.getlink_canonical_products p
set
  pack_source_url=best.pack_source_url,
  pack_label_1=coalesce(best.label1,''),
  pack_qty_1=coalesce(best.qty1,0),
  pack_label_2=coalesce(best.label2,''),
  pack_qty_2=coalesce(best.qty2,0),
  pack_label_3=coalesce(best.label3,''),
  pack_qty_3=coalesce(best.qty3,0),
  updated_at=now()
from best
join current_score cs on cs.id=best.canonical_product_id
where p.id=best.canonical_product_id
  and best.score>cs.score;
