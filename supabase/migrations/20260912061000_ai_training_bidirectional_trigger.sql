create or replace function public.getlink_ai_enqueue_chat_message()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_member_a uuid;
  v_member_b uuid;
  v_other_id uuid;
  v_sender_role text;
  v_other_role text;
  v_customer_id uuid;
  v_is_pilot boolean := false;
begin
  if new.deleted_at is not null or btrim(coalesce(new.body,''))='' then
    return new;
  end if;

  -- AI replies are written back into v21_messages by the active admin account.
  -- They must never be re-enqueued as fresh training input.
  if coalesce(new.client_id,'') like 'ai:%' then
    return new;
  end if;

  select c.member_a,c.member_b
    into v_member_a,v_member_b
  from public.v21_conversations c
  where c.id=new.conversation_id;

  if new.sender_account_id not in (v_member_a,v_member_b) then
    return new;
  end if;

  v_other_id := case when new.sender_account_id=v_member_a then v_member_b else v_member_a end;

  select a.role into v_sender_role
  from public.v21_accounts a
  where a.id=new.sender_account_id
    and a.deleted_at is null
    and a.locked_at is null;

  select a.role into v_other_role
  from public.v21_accounts a
  where a.id=v_other_id
    and a.deleted_at is null
    and a.locked_at is null;

  if v_sender_role='admin' and v_other_role='user' then
    v_customer_id := v_other_id;
  elsif v_sender_role='user' and v_other_role='admin' then
    v_customer_id := new.sender_account_id;
  else
    return new;
  end if;

  select exists(
    select 1
    from public.getlink_ai_pilot_customers p
    where p.account_id=v_customer_id
      and p.enabled=true
  ) into v_is_pilot;

  if not v_is_pilot then
    return new;
  end if;

  insert into public.getlink_ai_message_inbox(
    message_id,conversation_id,customer_account_id,message_body,message_created_at,available_after
  ) values (
    new.id,new.conversation_id,v_customer_id,new.body,new.created_at,new.created_at + interval '4 seconds'
  )
  on conflict(message_id) do nothing;

  update public.getlink_ai_order_sessions
  set last_customer_message_at=new.created_at,
      updated_at=now()
  where conversation_id=new.conversation_id
    and state in ('collecting','awaiting_clarification','quoted','confirmed');

  return new;
end;
$function$;
