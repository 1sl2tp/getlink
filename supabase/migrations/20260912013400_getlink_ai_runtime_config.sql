begin;

create table if not exists public.getlink_ai_runtime_settings (
  singleton boolean primary key default true check (singleton = true),
  mode text not null default 'off' check (mode in ('off','pilot')),
  model_name text not null default '',
  updated_at timestamptz not null default now()
);

insert into public.getlink_ai_runtime_settings(singleton,mode,model_name)
values(true,'off','')
on conflict(singleton) do nothing;

alter table public.getlink_ai_runtime_settings enable row level security;
revoke all on table public.getlink_ai_runtime_settings from public, anon, authenticated;
grant all on table public.getlink_ai_runtime_settings to service_role;

create or replace function public.getlink_ai_runtime_config()
returns table(
  mode text,
  model_name text,
  webhook_secret text,
  openai_api_key text,
  pilot_customer_ids uuid[]
)
language sql
security definer
set search_path = public, vault, pg_temp
as $$
  select
    s.mode,
    s.model_name,
    coalesce((
      select v.decrypted_secret
      from vault.decrypted_secrets v
      where v.name='getlink_order_agent_webhook_secret'
      order by v.created_at desc
      limit 1
    ),'') as webhook_secret,
    coalesce((
      select v.decrypted_secret
      from vault.decrypted_secrets v
      where v.name='getlink_order_agent_openai_api_key'
      order by v.created_at desc
      limit 1
    ),'') as openai_api_key,
    coalesce((
      select array_agg(p.account_id order by p.account_id)
      from public.getlink_ai_pilot_customers p
      where p.enabled=true
    ),'{}'::uuid[]) as pilot_customer_ids
  from public.getlink_ai_runtime_settings s
  where s.singleton=true
  limit 1;
$$;

revoke all on function public.getlink_ai_runtime_config() from public, anon, authenticated;
grant execute on function public.getlink_ai_runtime_config() to service_role;

commit;
