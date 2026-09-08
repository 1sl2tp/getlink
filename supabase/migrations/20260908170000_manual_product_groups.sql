-- User-owned manual product groups.
-- RAW/source groups stay untouched. Manual groups are a separate arrangement layer.

create table if not exists public.getlink_manual_groups (
  group_key text primary key,
  name text not null,
  rule_type text not null default 'name_contains',
  rule_value text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint getlink_manual_groups_name_check check (btrim(name) <> ''),
  constraint getlink_manual_groups_rule_check check (rule_type in ('name_contains')),
  constraint getlink_manual_groups_rule_value_check check (btrim(rule_value) <> '')
);

create table if not exists public.getlink_manual_group_members (
  group_key text not null references public.getlink_manual_groups(group_key) on delete cascade,
  link_url text not null,
  match_origin text not null default 'rule',
  matched_at timestamptz not null default now(),
  primary key(group_key,link_url),
  constraint getlink_manual_group_members_origin_check check (match_origin in ('rule','manual'))
);

create index if not exists idx_getlink_manual_group_members_link
  on public.getlink_manual_group_members(link_url);

alter table public.getlink_manual_groups enable row level security;
alter table public.getlink_manual_group_members enable row level security;
revoke all on table public.getlink_manual_groups from anon,authenticated;
revoke all on table public.getlink_manual_group_members from anon,authenticated;

insert into public.getlink_manual_groups(
  group_key,name,rule_type,rule_value,enabled,updated_at
)
values(
  'dau-an','Dầu ăn','name_contains','dầu ăn',true,now()
)
on conflict (group_key) do update
set name=excluded.name,
    rule_type=excluded.rule_type,
    rule_value=excluded.rule_value,
    enabled=excluded.enabled,
    updated_at=now();

delete from public.getlink_manual_group_members
where group_key='dau-an';

insert into public.getlink_manual_group_members(
  group_key,link_url,match_origin,matched_at
)
select
  'dau-an',
  l.canonical_url,
  'rule',
  now()
from public.getlink_links l
where l.link_type='product'
  and l.last_status<>'unlisted'
  and lower(coalesce(l.name,'')) like '%dầu ăn%'
on conflict (group_key,link_url) do nothing;
