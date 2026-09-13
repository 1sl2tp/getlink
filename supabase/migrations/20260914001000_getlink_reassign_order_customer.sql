begin;

create or replace function public.getlink_sales_reassign_order_customer(
  p_id uuid,
  p_customer_id uuid,
  p_actor_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.getlink_sales_orders%rowtype;
begin
  if not exists(
    select 1
    from public.v21_accounts
    where id=p_actor_id
      and role='admin'
      and deleted_at is null
      and locked_at is null
  ) then
    raise exception 'Admin required';
  end if;

  if not exists(
    select 1
    from public.v21_accounts
    where id=p_customer_id
      and role='user'
      and contact_group='customer'
      and deleted_at is null
      and locked_at is null
  ) then
    raise exception 'Invalid customer';
  end if;

  select * into v_order
  from public.getlink_sales_orders
  where id=p_id
  for update;

  if v_order.id is null then
    raise exception 'Order not found';
  end if;
  if v_order.status not in ('pending','delivered') then
    raise exception 'Returned order customer cannot be changed';
  end if;
  if v_order.customer_account_id=p_customer_id then
    return p_id;
  end if;

  update public.getlink_sales_orders
  set customer_account_id=p_customer_id,
      updated_at=now(),
      version=version+1
  where id=p_id;

  if v_order.status='delivered' then
    update public.getlink_debt_ledger
    set customer_account_id=p_customer_id
    where order_id=p_id;
  end if;

  return p_id;
end;
$$;

revoke all on function public.getlink_sales_reassign_order_customer(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.getlink_sales_reassign_order_customer(uuid,uuid,uuid) to service_role;

commit;
