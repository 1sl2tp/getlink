begin;

create or replace function public.getlink_ai_runtime_config_gemini()
returns table(
  mode text,
  model_name text,
  webhook_secret text,
  gemini_api_key text,
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
      where v.name='getlink_order_agent_gemini_api_key'
      order by v.created_at desc
      limit 1
    ),'') as gemini_api_key,
    coalesce((
      select array_agg(p.account_id order by p.account_id)
      from public.getlink_ai_pilot_customers p
      where p.enabled=true
    ),'{}'::uuid[]) as pilot_customer_ids
  from public.getlink_ai_runtime_settings s
  where s.singleton=true
  limit 1;
$$;

revoke all on function public.getlink_ai_runtime_config_gemini() from public, anon, authenticated;
grant execute on function public.getlink_ai_runtime_config_gemini() to service_role;

commit;
