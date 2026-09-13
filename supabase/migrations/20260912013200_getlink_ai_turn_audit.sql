begin;

create table if not exists public.getlink_ai_turn_audit (
  id uuid primary key default gen_random_uuid(),
  turn_key text not null check (btrim(turn_key) <> ''),
  conversation_id uuid not null references public.v21_conversations(id) on delete cascade,
  customer_account_id uuid not null references public.v21_accounts(id) on update cascade on delete restrict,
  source_message_ids uuid[] not null default '{}'::uuid[],
  mode text not null check (mode in ('shadow','pilot','on')),
  parsed_intent jsonb,
  candidate_product_codes text[] not null default '{}'::text[],
  selected_product_code text,
  resolution_source text,
  result_kind text,
  commercial_facts jsonb,
  reply_outbox_id uuid references public.getlink_ai_reply_outbox(id) on delete set null,
  model_request_id text,
  model_latency_ms integer check (model_latency_ms is null or model_latency_ms >= 0),
  error_code text,
  created_at timestamptz not null default now(),
  unique(turn_key,mode)
);

create index if not exists getlink_ai_turn_audit_customer_idx
  on public.getlink_ai_turn_audit(customer_account_id,created_at desc);
create index if not exists getlink_ai_turn_audit_conversation_idx
  on public.getlink_ai_turn_audit(conversation_id,created_at desc);

alter table public.getlink_ai_turn_audit enable row level security;
revoke all on table public.getlink_ai_turn_audit from public, anon, authenticated;
grant all on table public.getlink_ai_turn_audit to service_role;

commit;
