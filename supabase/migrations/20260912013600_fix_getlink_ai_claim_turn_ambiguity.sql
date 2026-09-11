begin;

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

  update public.getlink_ai_message_inbox i
  set status='pending',
      claimed_at=null,
      turn_key=null,
      last_error='stale_claim_recovered'
  where i.conversation_id=p_conversation_id
    and i.status='claimed'
    and i.claimed_at < now()-interval '5 minutes';

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

commit;
