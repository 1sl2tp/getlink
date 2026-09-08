create extension if not exists pgcrypto with schema extensions;

-- Immutable RAW source responses for GETLINK.
-- source_original rows are captured before normalize/map/filter/canonical.
-- Historical data cannot be reconstructed as true source RAW; it is retained only as legacy_processed.

create table if not exists public.getlink_raw_fetches (
  raw_id bigint generated always as identity primary key,
  request_id text not null,
  request_seq integer not null,
  source_key text not null,
  input_url text not null,
  input_type text not null,
  capture_stage text not null,
  fetched_at timestamptz not null,
  endpoint text not null,
  http_method text not null,
  http_status integer not null,
  content_type text not null default '',
  response_body text not null,
  body_sha256 text not null,
  created_at timestamptz not null default now(),
  constraint getlink_raw_fetches_stage_check
    check (capture_stage in ('source_original','legacy_processed')),
  constraint getlink_raw_fetches_seq_check check (request_seq >= 0),
  unique(request_id,request_seq)
);

create index if not exists idx_getlink_raw_fetches_source_time
  on public.getlink_raw_fetches(source_key,fetched_at desc);

create index if not exists idx_getlink_raw_fetches_input_time
  on public.getlink_raw_fetches(input_url,fetched_at desc);

alter table public.getlink_raw_fetches enable row level security;
revoke all on table public.getlink_raw_fetches from anon, authenticated;

create or replace function public.getlink_raw_fetches_reject_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'getlink_raw_fetches is append-only';
end;
$$;

drop trigger if exists trg_getlink_raw_fetches_immutable on public.getlink_raw_fetches;
create trigger trg_getlink_raw_fetches_immutable
before update or delete on public.getlink_raw_fetches
for each row execute function public.getlink_raw_fetches_reject_mutation();

-- Keep historical processed job payloads for audit, but never label them as source_original.
insert into public.getlink_raw_fetches(
  request_id,request_seq,source_key,input_url,input_type,capture_stage,
  fetched_at,endpoint,http_method,http_status,content_type,response_body,body_sha256,created_at
)
select
  j.request_id,
  0,
  case
    when lower(j.input_url) like '%winmart.vn%' then 'winmart'
    when lower(j.input_url) like '%sieuthi-go.vn%' then 'go'
    else 'bachhoaxanh'
  end,
  j.input_url,
  coalesce(j.link_type,''),
  'legacy_processed',
  coalesce(j.updated_at,j.created_at,now()),
  'legacy:getlink_jobs.result_json',
  'INTERNAL',
  200,
  'application/json; legacy-processed',
  j.result_json::text,
  encode(digest(convert_to(j.result_json::text,'UTF8'),'sha256'),'hex'),
  coalesce(j.updated_at,j.created_at,now())
from public.getlink_jobs j
where j.result_json is not null
on conflict (request_id,request_seq) do nothing;
