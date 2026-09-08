-- Broad manual group: Bánh.
-- This is intentionally coarse. More detailed cake/biscuit/snack subgroups can be split later.
-- Already-classified products are skipped by the exclusive manual-group rule.

insert into public.getlink_manual_groups(
  group_key,name,rule_type,rule_value,enabled,updated_at
)
values(
  'banh','Bánh','name_contains','bánh',true,now()
)
on conflict (group_key) do update
set name=excluded.name,
    enabled=excluded.enabled,
    updated_at=now();

delete from public.getlink_manual_group_rules
where group_key='banh';

insert into public.getlink_manual_group_rules(
  group_key,rule_type,rule_value,rule_order,enabled
)
values
  ('banh','name_product_phrase','bánh',10,true);

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
      normalize(lower(l.name),NFC) like 'bánh%'
      or (
        normalize(lower(l.name),NFC) like 'thùng %'
        and normalize(lower(l.name),NFC) like '%bánh%'
      )
    )
)
insert into public.getlink_manual_group_members(
  group_key,link_url,match_origin,matched_at
)
select 'banh',canonical_url,'rule',now()
from matched
on conflict do nothing;
