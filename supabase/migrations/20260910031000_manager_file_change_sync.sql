-- Manager-file change sync without periodic data polling.
-- Apps Script owns NCC <-> manager file. GETLINK only watches the manager file,
-- then mirrors manager-file changes to Supabase/Web.
-- Legacy supplier/NCC cron is kept but locked (inactive) for rollback.

create table if not exists public.getlink_manager_sync_state (
  id smallint primary key default 1 check (id = 1),
  file_id text not null,
  last_modified_at timestamptz,
  last_synced_at timestamptz,
  last_trigger text,
  last_status text not null default 'idle',
  last_error text,
  updated_at timestamptz not null default now()
);

insert into public.getlink_manager_sync_state(id,file_id)
values (1,'1hGqAzIEqTMmULIeh5sCmed2R3XaiA9QZavtGRdNvyyU')
on conflict (id) do update
set file_id=excluded.file_id,
    updated_at=now();

alter table public.getlink_manager_sync_state enable row level security;
revoke all on public.getlink_manager_sync_state from anon, authenticated;
grant all on public.getlink_manager_sync_state to service_role;

-- The old supplier/NCC cron remains in place for rollback and is kept
-- inactive operationally. This migration does not delete or rewrite it.

-- Keep one lightweight renewal job. It does not read product data every run;
-- it only makes sure the manager Drive watch is alive.
do $$
declare
  existing_job bigint;
  cmd text := $cmd$
    select net.http_post(
      url := 'https://gcnoahqsrquxkwkjbuxy.supabase.co/functions/v1/getlink-sheet-sync/register-watches',
      headers := jsonb_build_object(
        'content-type','application/json',
        'x-getlink-cron',(select cron_secret from public.getlink_update_settings where id=1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  $cmd$;
begin
  select jobid into existing_job
  from cron.job
  where jobname='getlink-manager-watch-renew'
  order by jobid desc
  limit 1;

  if existing_job is null then
    perform cron.schedule(
      'getlink-manager-watch-renew',
      '17 */6 * * *',
      cmd
    );
  end if;
end $;
