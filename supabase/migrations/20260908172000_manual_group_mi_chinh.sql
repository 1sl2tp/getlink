-- Manual group: Mì chính.
-- Independent from source/raw groups. Membership is derived from product names.

insert into public.getlink_manual_groups(
  group_key,name,rule_type,rule_value,enabled,updated_at
)
values(
  'mi-chinh','Mì chính','name_contains','mì chính',true,now()
)
on conflict (group_key) do update
set name=excluded.name,
    enabled=excluded.enabled,
    updated_at=now();

delete from public.getlink_manual_group_rules
where group_key='mi-chinh';

insert into public.getlink_manual_group_rules(
  group_key,rule_type,rule_value,rule_order,enabled
)
values
  ('mi-chinh','name_contains','mì chính',10,true),
  ('mi-chinh','name_contains','bột ngọt',20,true);

delete from public.getlink_manual_group_members
where group_key='mi-chinh'
  and match_origin='rule';

with rules as (
  select lower(rule_value) as rule_value
  from public.getlink_manual_group_rules
  where group_key='mi-chinh'
    and enabled=true
),
matched as (
  select distinct l.canonical_url
  from public.getlink_links l
  join rules r on lower(l.name) like '%'||r.rule_value||'%'
  where l.link_type='product'
    and l.last_status<>'unlisted'
)
insert into public.getlink_manual_group_members(
  group_key,link_url,match_origin,matched_at
)
select 'mi-chinh',canonical_url,'rule',now()
from matched
on conflict (group_key,link_url) do update
set match_origin=case
      when public.getlink_manual_group_members.match_origin='manual' then 'manual'
      else excluded.match_origin
    end,
    matched_at=excluded.matched_at;
