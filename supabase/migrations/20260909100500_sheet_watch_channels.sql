create table if not exists public.getlink_sheet_watch_channels (
  channel_id text primary key,
  file_id text not null,
  source_key text,
  channel_token text not null,
  resource_id text,
  resource_uri text,
  expires_at timestamptz,
  last_message_number bigint,
  last_resource_state text,
  last_notified_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists getlink_sheet_watch_channels_file_idx
  on public.getlink_sheet_watch_channels(file_id);

create index if not exists getlink_sheet_watch_channels_expiry_idx
  on public.getlink_sheet_watch_channels(expires_at)
  where active = true;

alter table public.getlink_sheet_watch_channels enable row level security;

revoke all on public.getlink_sheet_watch_channels from anon, authenticated;
grant all on public.getlink_sheet_watch_channels to service_role;
