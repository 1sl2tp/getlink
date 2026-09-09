create extension if not exists pg_cron;

create table if not exists public.getlink_update_settings (
  id smallint primary key default 1 check (id = 1),
  enabled boolean not null default false,
  interval_days smallint not null default 1 check (interval_days between 1 and 30),
  run_hour smallint not null default 3 check (run_hour between 0 and 23),
  scope text not null default 'all' check (scope in ('all','classified_only')),
  cron_secret text not null default encode(gen_random_bytes(32),'hex'),
  admin_session_hash text,
  admin_session_expires_at timestamptz,
  auth_fail_count integer not null default 0,
  auth_locked_until timestamptz,
  last_started_at timestamptz,
  last_completed_at timestamptz,
  last_status text not null default 'idle',
  last_summary jsonb not null default '{}'::jsonb,
  last_error text,
  updated_at timestamptz not null default now()
);

insert into public.getlink_update_settings(id)
values (1)
on conflict (id) do nothing;

alter table public.getlink_update_settings enable row level security;

create table if not exists public.getlink_update_runs (
  id text primary key,
  trigger_kind text not null check (trigger_kind in ('manual','schedule')),
  scope text not null check (scope in ('all','classified_only')),
  status text not null default 'queued' check (status in ('queued','running','complete','complete_with_errors','error')),
  total_categories integer not null default 0,
  done_categories integer not null default 0,
  success_categories integer not null default 0,
  failed_categories integer not null default 0,
  updated_products integer not null default 0,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  last_error text
);

alter table public.getlink_update_runs enable row level security;

create unique index if not exists getlink_update_runs_one_active
on public.getlink_update_runs ((1))
where status in ('queued','running');

create index if not exists getlink_update_runs_created_idx
on public.getlink_update_runs (created_at desc);

create table if not exists public.getlink_update_queue (
  run_id text not null references public.getlink_update_runs(id) on delete cascade,
  category_url text not null,
  source text not null default '',
  status text not null default 'pending' check (status in ('pending','running','complete','error')),
  attempts integer not null default 0,
  updated_products integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  primary key (run_id, category_url)
);

alter table public.getlink_update_queue enable row level security;

create index if not exists getlink_update_queue_pick_idx
on public.getlink_update_queue (run_id, status, source, category_url);

create or replace function public.getlink_update_scope_counts()
returns table(total_products bigint, classified_products bigint, unclassified_products bigint)
language sql
stable
security definer
set search_path = public
as $$
  with p as (
    select canonical_url
    from public.getlink_links
    where link_type='product'
      and coalesce(last_status,'') <> 'unlisted'
  ),
  classified as (
    select distinct m.link_url
    from public.getlink_manual_group_members m
    join public.getlink_manual_groups g
      on g.group_key=m.group_key
     and g.enabled=true
     and coalesce(g.is_fallback,false)=false
    join p on p.canonical_url=m.link_url
  )
  select
    (select count(*) from p),
    (select count(*) from classified),
    (select count(*) from p) - (select count(*) from classified);
$$;

create or replace function public.getlink_filter_classified_urls(p_urls text[])
returns table(link_url text)
language sql
stable
security definer
set search_path = public
as $$
  select distinct m.link_url
  from public.getlink_manual_group_members m
  join public.getlink_manual_groups g
    on g.group_key=m.group_key
   and g.enabled=true
   and coalesce(g.is_fallback,false)=false
  where m.link_url = any(coalesce(p_urls, array[]::text[]));
$$;

create or replace function public.getlink_claim_update_queue(p_run_id text, p_limit integer default 10)
returns table(category_url text, source text)
language sql
security definer
set search_path = public
as $$
  with picked as (
    select q.run_id, q.category_url
    from public.getlink_update_queue q
    where q.run_id=p_run_id
      and q.status='pending'
    order by
      case
        when lower(q.source) like '%winmart%' then 1
        when lower(q.source) like '%go%' then 2
        else 3
      end,
      q.category_url
    for update skip locked
    limit greatest(1, least(coalesce(p_limit,10),20))
  ),
  claimed as (
    update public.getlink_update_queue q
    set status='running',
        attempts=q.attempts+1,
        started_at=now(),
        last_error=null
    from picked p
    where q.run_id=p.run_id
      and q.category_url=p.category_url
    returning q.category_url, q.source
  )
  select * from claimed;
$$;

revoke all on public.getlink_update_settings from anon, authenticated;
revoke all on public.getlink_update_runs from anon, authenticated;
revoke all on public.getlink_update_queue from anon, authenticated;
revoke all on function public.getlink_update_scope_counts() from public;
revoke all on function public.getlink_filter_classified_urls(text[]) from public;
revoke all on function public.getlink_claim_update_queue(text,integer) from public;

grant execute on function public.getlink_update_scope_counts() to service_role;
grant execute on function public.getlink_filter_classified_urls(text[]) to service_role;
grant execute on function public.getlink_claim_update_queue(text,integer) to service_role;

do $$
declare
  existing_job bigint;
begin
  select jobid into existing_job
  from cron.job
  where jobname='getlink-auto-update-worker'
  order by jobid desc
  limit 1;

  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;

  perform cron.schedule(
    'getlink-auto-update-worker',
    '*/5 * * * *',
    $cron$
      select net.http_post(
        url := 'https://gcnoahqsrquxkwkjbuxy.supabase.co/functions/v1/getlink-api/api/auto-update/worker',
        headers := jsonb_build_object(
          'content-type','application/json',
          'x-getlink-cron',(select cron_secret from public.getlink_update_settings where id=1)
        ),
        body := '{}'::jsonb
      );
    $cron$
  );
end
$$;
