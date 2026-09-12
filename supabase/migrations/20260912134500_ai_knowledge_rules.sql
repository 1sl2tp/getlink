create table if not exists public.getlink_ai_knowledge_rules (
  id uuid primary key default gen_random_uuid(),
  customer_account_id uuid not null,
  rule_type text not null check (rule_type in ('behavior','naming','category','unit','product')),
  rule_text text not null,
  rule_normalized text not null,
  source_message_id text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint getlink_ai_knowledge_rules_customer_rule_key unique (customer_account_id, rule_normalized)
);

create index if not exists getlink_ai_knowledge_rules_customer_active_updated_idx
  on public.getlink_ai_knowledge_rules (customer_account_id, is_active, updated_at desc);

alter table public.getlink_ai_knowledge_rules enable row level security;
revoke all on table public.getlink_ai_knowledge_rules from anon, authenticated;
grant all on table public.getlink_ai_knowledge_rules to service_role;
