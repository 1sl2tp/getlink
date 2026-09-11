begin;

-- Pilot intake gate. Only explicitly allowlisted customer accounts may enter
-- the AI inbox. This is independent of Edge rollout mode so non-pilot chat
-- content is never copied into the AI subsystem during a restricted pilot.
create table if not exists public.getlink_ai_pilot_customers (
  account_id uuid primary key references public.v21_accounts(id) on update cascade on delete cascade,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.getlink_ai_pilot_customers enable row level security;
revoke all on table public.getlink_ai_pilot_customers from public, anon, authenticated;
grant all on table public.getlink_ai_pilot_customers to service_role;

create or replace function public.getlink_ai_enqueue_chat_message()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_other_admin boolean := false;
  v_is_pilot boolean := false;
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
    from public.getlink_ai_pilot_customers p
    where p.account_id = new.sender_account_id
      and p.enabled = true
  ) into v_is_pilot;

  if not v_is_pilot then
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

commit;
