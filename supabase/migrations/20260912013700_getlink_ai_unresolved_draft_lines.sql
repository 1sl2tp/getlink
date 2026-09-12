begin;

create table if not exists public.getlink_ai_unresolved_draft_lines (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.getlink_ai_order_sessions(id) on delete cascade,
  line_key text not null check (btrim(line_key) <> ''),
  source_message_id uuid references public.v21_messages(id) on delete set null,
  raw_text text not null check (btrim(raw_text) <> ''),
  raw_product_text text not null check (btrim(raw_product_text) <> ''),
  quantity numeric check (quantity is null or quantity > 0),
  unit_hint text,
  context_family text,
  candidate_product_codes jsonb not null default '[]'::jsonb,
  reason text not null
    check (reason in ('not_in_catalog','ambiguous','size_mismatch','needs_owner_confirmation','other')),
  status text not null default 'pending'
    check (status in ('pending','resolved','dismissed')),
  resolved_product_code text references public.getlink_supplier_products(product_code) on update cascade on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(session_id,line_key)
);

create index if not exists getlink_ai_unresolved_pending_idx
  on public.getlink_ai_unresolved_draft_lines(session_id,created_at)
  where status='pending';

alter table public.getlink_ai_unresolved_draft_lines enable row level security;

revoke all on table public.getlink_ai_unresolved_draft_lines from public, anon, authenticated;
grant all on table public.getlink_ai_unresolved_draft_lines to service_role;

commit;
