begin;

create or replace function public.getlink_sales_record_debt_adjustment(
  p_customer_id uuid,
  p_amount_vnd bigint,
  p_actor_id uuid,
  p_note text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  if p_amount_vnd is null or p_amount_vnd<=0 then
    raise exception 'Debt adjustment must be positive';
  end if;
  if not exists(
    select 1 from public.v21_accounts
    where id=p_actor_id and role='admin' and deleted_at is null and locked_at is null
  ) then raise exception 'Admin required'; end if;
  if not exists(
    select 1 from public.v21_accounts
    where id=p_customer_id and role='user' and contact_group='customer'
      and deleted_at is null and locked_at is null
  ) then raise exception 'Invalid GETLINK customer'; end if;

  insert into public.getlink_debt_ledger(
    id,customer_account_id,event_type,amount_vnd,direction,note,occurred_at,created_by_account_id
  ) values (
    v_id,p_customer_id,'manual_adjustment',p_amount_vnd,'increase',coalesce(p_note,''),now(),p_actor_id
  );
  return v_id;
end;
$$;

revoke all on function public.getlink_sales_record_debt_adjustment(uuid,bigint,uuid,text)
  from public,anon,authenticated;
grant execute on function public.getlink_sales_record_debt_adjustment(uuid,bigint,uuid,text)
  to service_role;

commit;
