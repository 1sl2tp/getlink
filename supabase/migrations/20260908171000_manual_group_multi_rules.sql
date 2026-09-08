-- Multiple OR conditions for user-owned manual groups.
-- Source/raw data remains untouched; this changes only the manual arrangement layer.

create table if not exists public.getlink_manual_group_rules (
  group_key text not null references public.getlink_manual_groups(group_key) on delete cascade,
  rule_type text not null,
  rule_value text not null,
  rule_order integer not null default 100,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(group_key,rule_type,rule_value),
  constraint getlink_manual_group_rules_type_check
    check (rule_type in ('name_contains','name_product_phrase')),
  constraint getlink_manual_group_rules_value_check
    check (btrim(rule_value) <> '')
);

create index if not exists idx_getlink_manual_group_rules_group_order
  on public.getlink_manual_group_rules(group_key,rule_order);

alter table public.getlink_manual_group_rules enable row level security;
revoke all on table public.getlink_manual_group_rules from anon,authenticated;

delete from public.getlink_manual_group_rules
where group_key='dau-an';

insert into public.getlink_manual_group_rules(
  group_key,rule_type,rule_value,rule_order,enabled
)
values
  ('dau-an','name_contains','dầu ăn',10,true),
  ('dau-an','name_product_phrase','dầu cooking',20,true),
  ('dau-an','name_product_phrase','dầu đậu nành',30,true),
  ('dau-an','name_product_phrase','dầu nành',40,true),
  ('dau-an','name_product_phrase','dầu hướng dương',50,true),
  ('dau-an','name_product_phrase','dầu gạo',60,true),
  ('dau-an','name_product_phrase','dầu hạt cải',70,true),
  ('dau-an','name_product_phrase','dầu dừa',80,true),
  ('dau-an','name_product_phrase','dầu bã oliu',90,true),
  ('dau-an','name_product_phrase','dầu ô liu',100,true),
  ('dau-an','name_product_phrase','dầu oliu',110,true),
  ('dau-an','name_product_phrase','dầu rán o liu',120,true),
  ('dau-an','name_product_phrase','dầu thực vật',130,true),
  ('dau-an','name_product_phrase','dầu mè',140,true),
  ('dau-an','name_product_phrase','dầu gấc',150,true);

-- Rebuild rule-origin membership for Dầu ăn from the full OR condition set.
delete from public.getlink_manual_group_members
where group_key='dau-an'
  and match_origin='rule';

with rules as (
  select rule_type,lower(rule_value) as rule_value
  from public.getlink_manual_group_rules
  where group_key='dau-an' and enabled=true
),
matched as (
  select distinct l.canonical_url
  from public.getlink_links l
  join rules r on (
    (r.rule_type='name_contains' and lower(l.name) like '%'||r.rule_value||'%')
    or
    (
      r.rule_type='name_product_phrase'
      and (
        lower(l.name) like r.rule_value||'%'
        or (
          lower(l.name) like 'thùng %'
          and lower(l.name) like '%'||r.rule_value||'%'
        )
      )
    )
  )
  where l.link_type='product'
    and l.last_status<>'unlisted'
)
insert into public.getlink_manual_group_members(
  group_key,link_url,match_origin,matched_at
)
select 'dau-an',canonical_url,'rule',now()
from matched
on conflict (group_key,link_url) do update
set match_origin=case
      when public.getlink_manual_group_members.match_origin='manual' then 'manual'
      else excluded.match_origin
    end,
    matched_at=excluded.matched_at;
