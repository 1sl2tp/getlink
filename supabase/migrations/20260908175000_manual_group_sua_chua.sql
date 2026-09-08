-- Manual group: Sữa chua.
-- Use structured name rules so yogurt products are included while
-- yogurt-flavoured candy/jelly/personal-care/drinks are excluded.

alter table public.getlink_manual_group_rules
  drop constraint if exists getlink_manual_group_rules_type_check;

alter table public.getlink_manual_group_rules
  add constraint getlink_manual_group_rules_type_check
  check (
    rule_type in (
      'name_contains',
      'name_product_phrase',
      'name_product_pack_phrase',
      'name_pack_contains'
    )
  );

insert into public.getlink_manual_groups(
  group_key,name,rule_type,rule_value,enabled,updated_at
)
values(
  'sua-chua','Sữa chua','name_contains','sữa chua',true,now()
)
on conflict (group_key) do update
set name=excluded.name,
    enabled=excluded.enabled,
    updated_at=now();

delete from public.getlink_manual_group_rules
where group_key='sua-chua';

insert into public.getlink_manual_group_rules(
  group_key,rule_type,rule_value,rule_order,enabled
)
values
  ('sua-chua','name_product_pack_phrase','sữa chua',10,true),
  ('sua-chua','name_product_pack_phrase','yogurt',20,true),
  ('sua-chua','name_product_pack_phrase','yoghurt',30,true),
  ('sua-chua','name_product_pack_phrase','yaourt',40,true),
  ('sua-chua','name_product_pack_phrase','thức uống từ sữa chua',50,true),
  ('sua-chua','name_pack_contains','th true yogurt',60,true);

with matched as (
  select distinct l.canonical_url
  from public.getlink_links l
  where l.link_type='product'
    and l.last_status<>'unlisted'
    and not exists (
      select 1
      from public.getlink_manual_group_members existing
      where existing.link_url=l.canonical_url
    )
    and (
      normalize(lower(l.name),NFC) like 'sữa chua%'
      or normalize(lower(l.name),NFC) like 'yogurt%'
      or normalize(lower(l.name),NFC) like 'yoghurt%'
      or normalize(lower(l.name),NFC) like 'yaourt%'
      or normalize(lower(l.name),NFC) ~
        '^(lốc|lô|vỉ|vĩ|thùng|khay)[[:space:]]+[0-9]+[[:space:]]+((chai|hộp|hũ|túi|gói|lốc)[[:space:]]+)?([^[:space:]]+[[:space:]]+)?(sữa chua|yogurt|yoghurt|yaourt)'
      or normalize(lower(l.name),NFC) like 'thức uống từ sữa chua%'
      or (
        normalize(lower(l.name),NFC) ~
          '^(lốc|lô|vỉ|vĩ|thùng|khay)[[:space:]]+[0-9]+'
        and normalize(lower(l.name),NFC) like '%th true yogurt%'
      )
    )
)
insert into public.getlink_manual_group_members(
  group_key,link_url,match_origin,matched_at
)
select 'sua-chua',canonical_url,'rule',now()
from matched
on conflict do nothing;
