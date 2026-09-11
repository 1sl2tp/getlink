create table if not exists public.getlink_ai_training_examples (
  id uuid primary key default gen_random_uuid(),
  customer_account_id uuid not null,
  conversation_id uuid not null,
  source_message_id uuid,
  raw_text text not null,
  raw_normalized text not null,
  product_name text not null,
  product_code text,
  quantity numeric,
  unit_hint text,
  status text not null default 'auto',
  confidence numeric not null default 0.5,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint getlink_ai_training_examples_status_check check (status in ('auto','corrected','rejected')),
  constraint getlink_ai_training_examples_quantity_check check (quantity is null or quantity > 0),
  constraint getlink_ai_training_examples_confidence_check check (confidence >= 0 and confidence <= 1),
  constraint unique_training_example unique (customer_account_id, conversation_id, raw_normalized)
);

create index if not exists getlink_ai_training_examples_customer_recent_idx
  on public.getlink_ai_training_examples (customer_account_id, updated_at desc);

create index if not exists getlink_ai_training_examples_conversation_recent_idx
  on public.getlink_ai_training_examples (conversation_id, updated_at desc);

alter table public.getlink_ai_training_examples enable row level security;

revoke all on table public.getlink_ai_training_examples from anon;
revoke all on table public.getlink_ai_training_examples from authenticated;
grant all on table public.getlink_ai_training_examples to service_role;
