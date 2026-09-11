begin;

-- GETLINK AI Sales Order Agent v1.
-- Conversational state only. Canonical sales accounting remains in the existing
-- GETLINK native sales core. Customer turns are debounced for 4 seconds.

create table if not exists public.getlink_ai_order_sessions (
  id uuid primary key default gen_random_uuid(),
  customer_account_id uuid not null references public.v21_accounts(id) on update cascade on delete restrict,
  conversation_id uuid not null references public.v21_conversations(id) on delete cascade,
  state text not null default 'collecting'
    check (state in ('collecting','awaiting_clarification','quoted','confirmed','handed_off','closed')),
  awaiting_context jsonb not null default '{}'::jsonb,
  last_price_list_context jsonb not null default '{}'::jsonb,
  last_customer_message_at timestamptz,
  last_turn_key text,
  round_upsell_offered boolean not null default false,
  round_upsell_declined boolean not null default false,
  sales_order_id uuid references public.getlink_sales_orders(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists getlink_ai_one_open_session_per_conversation_idx
  on public.getlink_ai_order_sessions(conversation_id)
  where state in ('collecting','awaiting_clarification','quoted','confirmed');
create index if not exists getlink_ai_sessions_customer_idx
  on public.getlink_ai_order_sessions(customer_account_id,updated_at desc);

create table if not exists public.getlink_ai_order_draft_lines (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.getlink_ai_order_sessions(id) on delete cascade,
  line_key text not null check (btrim(line_key) <> ''),
  product_code text not null references public.getlink_supplier_products(product_code) on update cascade on delete restrict,
  customer_raw_text text not null default '',
  quantity numeric not null check (quantity > 0),
  unit_hint text,
  attributes jsonb not null default '{}'::jsonb,
  line_note text not null default '',
  quoted_price_vnd bigint check (quoted_price_vnd is null or quoted_price_vnd >= 0),
  matcher_confidence numeric not null default 1 check (matcher_confidence >= 0 and matcher_confidence <= 1),
  resolution_source text not null
    check (resolution_source in ('customer_alias','store_alias','canonical','fuzzy','llm','clarification','admin_edit')),
  source_message_id uuid references public.v21_messages(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(session_id,line_key)
);

create index if not exists getlink_ai_draft_lines_session_idx
  on public.getlink_ai_order_draft_lines(session_id,created_at);
create index if not exists getlink_ai_draft_lines_product_idx
  on public.getlink_ai_order_draft_lines(product_code);

create table if not exists public.getlink_ai_product_aliases (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('customer','store')),
  customer_account_id uuid references public.v21_accounts(id) on update cascade on delete cascade,
  product_code text not null references public.getlink_supplier_products(product_code) on update cascade on delete restrict,
  alias_display text not null check (btrim(alias_display) <> ''),
  alias_normalized text not null check (btrim(alias_normalized) <> ''),
  confidence numeric not null default 0.5 check (confidence >= 0 and confidence <= 1),
  confirm_count integer not null default 0 check (confirm_count >= 0),
  correction_count integer not null default 0 check (correction_count >= 0),
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (scope='customer' and customer_account_id is not null)
    or (scope='store' and customer_account_id is null)
  )
);

create unique index if not exists getlink_ai_customer_alias_unique_idx
  on public.getlink_ai_product_aliases(customer_account_id,alias_normalized)
  where scope='customer';
create unique index if not exists getlink_ai_store_alias_unique_idx
  on public.getlink_ai_product_aliases(alias_normalized)
  where scope='store';
create index if not exists getlink_ai_alias_product_idx
  on public.getlink_ai_product_aliases(product_code,scope);

create table if not exists public.getlink_ai_corrections (
  id uuid primary key default gen_random_uuid(),
  customer_account_id uuid not null references public.v21_accounts(id) on update cascade on delete restrict,
  conversation_id uuid not null references public.v21_conversations(id) on delete cascade,
  session_id uuid references public.getlink_ai_order_sessions(id) on delete set null,
  source_message_id uuid references public.v21_messages(id) on delete set null,
  raw_customer_phrase text not null,
  prior_product_code text,
  corrected_product_code text not null references public.getlink_supplier_products(product_code) on update cascade on delete restrict,
  correction_source text not null
    check (correction_source in ('customer_confirmation','admin_edit','clarification')),
  created_at timestamptz not null default now()
);

create index if not exists getlink_ai_corrections_alias_idx
  on public.getlink_ai_corrections(customer_account_id,created_at desc);

create table if not exists public.getlink_ai_product_hints (
  product_code text primary key references public.getlink_supplier_products(product_code) on update cascade on delete cascade,
  ask_attribute text check (ask_attribute is null or ask_attribute in ('color','flavor','size','pack','other')),
  allowed_values jsonb not null default '[]'::jsonb,
  sales_hint text not null default '',
  market_reference_source text,
  market_reference_key text,
  equivalence_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.getlink_ai_message_inbox (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.v21_messages(id) on delete cascade,
  conversation_id uuid not null references public.v21_conversations(id) on delete cascade,
  customer_account_id uuid not null references public.v21_accounts(id) on update cascade on delete restrict,
  message_body text not null,
  message_created_at timestamptz not null,
  available_after timestamptz not null default (now() + interval '4 seconds'),
  status text not null default 'pending'
    check (status in ('pending','claimed','processed','ignored','failed')),
  turn_key text,
  claimed_at timestamptz,
  processed_at timestamptz,
  last_error text,
  dispatch_request_id bigint,
  created_at timestamptz not null default now(),
  unique(message_id)
);

create index if not exists getlink_ai_inbox_pending_idx
  on public.getlink_ai_message_inbox(conversation_id,status,message_created_at)
  where status in ('pending','claimed');

create table if not exists public.getlink_ai_reply_outbox (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.getlink_ai_order_sessions(id) on delete cascade,
  turn_key text not null check (btrim(turn_key) <> ''),
  reply_kind text not null
    check (reply_kind in ('order_update','clarification','price','price_list','confirmation','upsell','fallback')),
  body text not null check (char_length(btrim(body)) between 1 and 8000),
  status text not null default 'pending' check (status in ('pending','sending','sent','failed')),
  chat_message_id uuid references public.v21_messages(id) on delete set null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique(session_id,turn_key,reply_kind)
);

create index if not exists getlink_ai_outbox_pending_idx
  on public.getlink_ai_reply_outbox(status,created_at)
  where status in ('pending','failed');

alter table public.getlink_ai_order_sessions enable row level security;
alter table public.getlink_ai_order_draft_lines enable row level security;
alter table public.getlink_ai_product_aliases enable row level security;
alter table public.getlink_ai_corrections enable row level security;
alter table public.getlink_ai_product_hints enable row level security;
alter table public.getlink_ai_message_inbox enable row level security;
alter table public.getlink_ai_reply_outbox enable row level security;

revoke all on table public.getlink_ai_order_sessions from public, anon, authenticated;
revoke all on table public.getlink_ai_order_draft_lines from public, anon, authenticated;
revoke all on table public.getlink_ai_product_aliases from public, anon, authenticated;
revoke all on table public.getlink_ai_corrections from public, anon, authenticated;
revoke all on table public.getlink_ai_product_hints from public, anon, authenticated;
revoke all on table public.getlink_ai_message_inbox from public, anon, authenticated;
revoke all on table public.getlink_ai_reply_outbox from public, anon, authenticated;

grant all on table public.getlink_ai_order_sessions to service_role;
grant all on table public.getlink_ai_order_draft_lines to service_role;
grant all on table public.getlink_ai_product_aliases to service_role;
grant all on table public.getlink_ai_corrections to service_role;
grant all on table public.getlink_ai_product_hints to service_role;
grant all on table public.getlink_ai_message_inbox to service_role;
grant all on table public.getlink_ai_reply_outbox to service_role;

create or replace function public.getlink_ai_enqueue_chat_message()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_other_admin boolean := false;
begin
  if new.deleted_at is not null or btrim(coalesce(new.body,''))='' then
    return new;
  end if;

  select a.role into v_role
  from public.v21_accounts a
  where a.id=new.sender_account_id
    and a.deleted_at is null
    and a.locked_at is null;

  if v_role is distinct from 'user' then
    return new;
  end if;

  select exists(
    select 1
    from public.v21_conversations c
    join public.v21_accounts a
      on a.id = case when c.member_a=new.sender_account_id then c.member_b else c.member_a end
    where c.id=new.conversation_id
      and new.sender_account_id in (c.member_a,c.member_b)
      and a.role='admin'
      and a.deleted_at is null
      and a.locked_at is null
  ) into v_other_admin;

  if not v_other_admin then
    return new;
  end if;

  insert into public.getlink_ai_message_inbox(
    message_id,conversation_id,customer_account_id,message_body,message_created_at,available_after
  ) values (
    new.id,new.conversation_id,new.sender_account_id,new.body,new.created_at,new.created_at + interval '4 seconds'
  )
  on conflict(message_id) do nothing;

  update public.getlink_ai_order_sessions
  set last_customer_message_at=new.created_at,
      updated_at=now()
  where conversation_id=new.conversation_id
    and state in ('collecting','awaiting_clarification','quoted','confirmed');

  return new;
end;
$$;

revoke all on function public.getlink_ai_enqueue_chat_message() from public, anon, authenticated;

drop trigger if exists getlink_ai_enqueue_chat_message_trg on public.v21_messages;
create trigger getlink_ai_enqueue_chat_message_trg
after insert on public.v21_messages
for each row execute function public.getlink_ai_enqueue_chat_message();

create or replace function public.getlink_ai_claim_turn(p_conversation_id uuid)
returns table(
  inbox_id uuid,
  message_id uuid,
  conversation_id uuid,
  customer_account_id uuid,
  message_body text,
  message_created_at timestamptz,
  turn_key text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_latest timestamptz;
  v_turn text := gen_random_uuid()::text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_conversation_id::text,0));

  update public.getlink_ai_message_inbox
  set status='pending',claimed_at=null,turn_key=null,last_error='stale_claim_recovered'
  where conversation_id=p_conversation_id
    and status='claimed'
    and claimed_at < now()-interval '5 minutes';

  select max(i.message_created_at)
    into v_latest
  from public.getlink_ai_message_inbox i
  where i.conversation_id=p_conversation_id
    and i.status='pending';

  if v_latest is null or v_latest > now()-interval '4 seconds' then
    return;
  end if;

  return query
  with claimed as (
    update public.getlink_ai_message_inbox i
    set status='claimed',
        claimed_at=now(),
        turn_key=v_turn
    where i.conversation_id=p_conversation_id
      and i.status='pending'
      and i.message_created_at <= v_latest
    returning i.id,i.message_id,i.conversation_id,i.customer_account_id,i.message_body,i.message_created_at,i.turn_key
  )
  select c.id,c.message_id,c.conversation_id,c.customer_account_id,c.message_body,c.message_created_at,c.turn_key
  from claimed c
  order by c.message_created_at,c.id;
end;
$$;

revoke all on function public.getlink_ai_claim_turn(uuid) from public, anon, authenticated;
grant execute on function public.getlink_ai_claim_turn(uuid) to service_role;

create or replace function public.getlink_ai_send_chat_message(
  p_outbox_id uuid,
  p_body text,
  p_client_id text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_conversation_id uuid;
  v_admin_id uuid;
  v_body text := btrim(coalesce(p_body,''));
  v_client_id text := left(btrim(coalesce(p_client_id,'')),120);
  v_message_id uuid;
begin
  if char_length(v_body) < 1 or char_length(v_body) > 8000 then
    raise exception 'invalid_message';
  end if;
  if v_client_id='' or v_client_id not like 'ai:%' then
    raise exception 'invalid_ai_client_id';
  end if;

  select s.conversation_id
    into v_conversation_id
  from public.getlink_ai_reply_outbox o
  join public.getlink_ai_order_sessions s on s.id=o.session_id
  where o.id=p_outbox_id;

  if v_conversation_id is null then
    raise exception 'outbox_not_found';
  end if;

  select a.id
    into v_admin_id
  from public.v21_conversations c
  join public.v21_accounts a on a.id in (c.member_a,c.member_b)
  where c.id=v_conversation_id
    and a.role='admin'
    and a.deleted_at is null
    and a.locked_at is null
  order by a.created_at,a.id
  limit 1;

  if v_admin_id is null then
    raise exception 'active_admin_not_found';
  end if;

  insert into public.v21_messages as m(conversation_id,sender_account_id,client_id,body)
  values(v_conversation_id,v_admin_id,v_client_id,v_body)
  on conflict on constraint v21_messages_sender_account_id_client_id_key
  do update set client_id=excluded.client_id
  returning m.id into v_message_id;

  update public.getlink_ai_reply_outbox
  set status='sent',
      chat_message_id=v_message_id,
      sent_at=coalesce(sent_at,now()),
      attempt_count=attempt_count+1,
      last_error=null
  where id=p_outbox_id;

  return v_message_id;
end;
$$;

revoke all on function public.getlink_ai_send_chat_message(uuid,text,text) from public, anon, authenticated;
grant execute on function public.getlink_ai_send_chat_message(uuid,text,text) to service_role;

create or replace function public.getlink_ai_pending_dispatches(p_limit integer default 100)
returns table(message_id uuid,conversation_id uuid)
language sql
security definer
set search_path = public, pg_temp
as $$
  select i.message_id,i.conversation_id
  from public.getlink_ai_message_inbox i
  where i.status='pending'
    and i.created_at <= now()-interval '30 seconds'
  order by i.created_at
  limit greatest(1,least(coalesce(p_limit,100),500));
$$;

revoke all on function public.getlink_ai_pending_dispatches(integer) from public, anon, authenticated;
grant execute on function public.getlink_ai_pending_dispatches(integer) to service_role;

create or replace function public.getlink_ai_promote_aliases()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer := 0;
begin
  with eligible as (
    select a.alias_normalized,
           min(a.alias_display) as alias_display,
           a.product_code,
           count(distinct a.customer_account_id) as customer_count
    from public.getlink_ai_product_aliases a
    where a.scope='customer'
      and a.confirm_count > 0
      and a.correction_count=0
    group by a.alias_normalized,a.product_code
    having count(distinct a.customer_account_id) >= 3
       and not exists (
         select 1
         from public.getlink_ai_product_aliases conflict
         where conflict.scope='customer'
           and conflict.alias_normalized=a.alias_normalized
           and conflict.product_code<>a.product_code
           and (conflict.confirm_count>0 or conflict.correction_count>0)
       )
  ), inserted as (
    insert into public.getlink_ai_product_aliases(
      scope,customer_account_id,product_code,alias_display,alias_normalized,confidence,confirm_count,correction_count,last_used_at
    )
    select 'store',null,e.product_code,e.alias_display,e.alias_normalized,0.95,e.customer_count,0,now()
    from eligible e
    on conflict do nothing
    returning 1
  )
  select count(*) into v_count from inserted;

  return v_count;
end;
$$;

revoke all on function public.getlink_ai_promote_aliases() from public, anon, authenticated;
grant execute on function public.getlink_ai_promote_aliases() to service_role;

create or replace function public.getlink_ai_dispatch_inbox()
returns trigger
language plpgsql
security definer
set search_path = public, vault, net, pg_temp
as $$
declare
  v_url text;
  v_secret text;
  v_request_id bigint;
begin
  begin
    select decrypted_secret into v_url
    from vault.decrypted_secrets
    where name='getlink_order_agent_url'
    limit 1;

    select decrypted_secret into v_secret
    from vault.decrypted_secrets
    where name='getlink_order_agent_webhook_secret'
    limit 1;

    if coalesce(btrim(v_url),'')='' or coalesce(btrim(v_secret),'')='' then
      return new;
    end if;

    select net.http_post(
      url:=v_url,
      headers:=jsonb_build_object(
        'content-type','application/json',
        'x-order-agent-secret',v_secret
      ),
      body:=jsonb_build_object(
        'message_id',new.message_id,
        'conversation_id',new.conversation_id
      ),
      timeout_milliseconds:=5000
    ) into v_request_id;

    update public.getlink_ai_message_inbox
    set dispatch_request_id=v_request_id
    where id=new.id;
  exception when others then
    update public.getlink_ai_message_inbox
    set last_error='dispatch:'||sqlerrm
    where id=new.id;
  end;

  return new;
end;
$$;

revoke all on function public.getlink_ai_dispatch_inbox() from public, anon, authenticated;

drop trigger if exists getlink_ai_dispatch_inbox_trg on public.getlink_ai_message_inbox;
create trigger getlink_ai_dispatch_inbox_trg
after insert on public.getlink_ai_message_inbox
for each row execute function public.getlink_ai_dispatch_inbox();

commit;
