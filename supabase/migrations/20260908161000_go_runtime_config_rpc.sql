create or replace function public.getlink_go_runtime_config()
returns jsonb
language sql
security definer
set search_path = public, vault
as $$
  select jsonb_build_object(
    'apiclientid', max(decrypted_secret) filter (where name='getlink_go_apiclientid'),
    'sign',        max(decrypted_secret) filter (where name='getlink_go_sign'),
    'token',       max(decrypted_secret) filter (where name='getlink_go_token'),
    'store',       max(decrypted_secret) filter (where name='getlink_go_store')
  )
  from vault.decrypted_secrets
  where name in (
    'getlink_go_apiclientid',
    'getlink_go_sign',
    'getlink_go_token',
    'getlink_go_store'
  );
$$;

revoke all on function public.getlink_go_runtime_config() from public;
revoke all on function public.getlink_go_runtime_config() from anon;
revoke all on function public.getlink_go_runtime_config() from authenticated;
grant execute on function public.getlink_go_runtime_config() to service_role;
