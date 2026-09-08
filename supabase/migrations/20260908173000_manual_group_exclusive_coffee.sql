-- Manual groups are exclusive: one product can belong to only one manual group.
-- Existing memberships act as a persistent "classified / skip" marker.

create unique index if not exists ux_getlink_manual_group_members_link_url
  on public.getlink_manual_group_members(link_url);

insert into public.getlink_manual_groups(
  group_key,name,rule_type,rule_value,enabled,updated_at
)
values(
  'ca-phe','Cà phê','name_contains','cà phê',true,now()
)
on conflict (group_key) do update
set name=excluded.name,
    enabled=excluded.enabled,
    updated_at=now();

delete from public.getlink_manual_group_rules
where group_key='ca-phe';

insert into public.getlink_manual_group_rules(
  group_key,rule_type,rule_value,rule_order,enabled
)
values
  ('ca-phe','name_product_phrase','cà phê',10,true),
  ('ca-phe','name_product_phrase','cafe',20,true),
  ('ca-phe','name_product_phrase','café',30,true),
  ('ca-phe','name_product_phrase','caffe',40,true);

-- Only unclassified products are eligible for the new group.
with rules as (
  select normalize(lower(rule_value),NFC) as rule_value
  from public.getlink_manual_group_rules
  where group_key='ca-phe'
    and enabled=true
),
matched as (
  select distinct l.canonical_url
  from public.getlink_links l
  join rules r on (
    normalize(lower(l.name),NFC) like r.rule_value||'%'
    or (
      normalize(lower(l.name),NFC) like 'thùng %'
      and normalize(lower(l.name),NFC) like '%'||r.rule_value||'%'
    )
  )
  where l.link_type='product'
    and l.last_status<>'unlisted'
    and not exists (
      select 1
      from public.getlink_manual_group_members existing
      where existing.link_url=l.canonical_url
    )
)
insert into public.getlink_manual_group_members(
  group_key,link_url,match_origin,matched_at
)
select 'ca-phe',canonical_url,'rule',now()
from matched
on conflict do nothing;
