begin;

-- Payment input is entered in compact thousand-unit UI, but this RPC always receives full VND.
-- Serialize same-customer/admin receipts and return the existing row for an accidental retry.
create or replace function public.getlink_sales_record_payment(
  p_customer_id uuid,p_amount_vnd bigint,p_actor_id uuid,p_note text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := gen_random_uuid();
  v_existing uuid;
begin
  if p_amount_vnd is null or p_amount_vnd<=0 then raise exception 'Payment must be positive'; end if;
  if not exists(
    select 1 from public.v21_accounts
    where id=p_actor_id and role='admin' and deleted_at is null and locked_at is null
  ) then raise exception 'Admin required'; end if;
  if not exists(
    select 1 from public.v21_accounts
    where id=p_customer_id and role='user' and deleted_at is null and locked_at is null
  ) then raise exception 'Invalid GETLINK customer'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_customer_id::text||':'||p_actor_id::text,0));

  select id into v_existing
  from public.getlink_debt_ledger
  where customer_account_id=p_customer_id
    and event_type='payment'
    and direction='decrease'
    and amount_vnd=p_amount_vnd
    and created_by_account_id=p_actor_id
    and note=coalesce(p_note,'')
    and occurred_at>=now()-interval '30 seconds'
  order by occurred_at desc,id desc
  limit 1;

  if v_existing is not null then
    return v_existing;
  end if;

  insert into public.getlink_debt_ledger(
    id,customer_account_id,event_type,amount_vnd,direction,note,occurred_at,created_by_account_id
  ) values (
    v_id,p_customer_id,'payment',p_amount_vnd,'decrease',coalesce(p_note,''),now(),p_actor_id
  );
  return v_id;
end;
$$;

revoke all on function public.getlink_sales_record_payment(uuid,bigint,uuid,text) from public,anon,authenticated;
grant execute on function public.getlink_sales_record_payment(uuid,bigint,uuid,text) to service_role;

commit;
