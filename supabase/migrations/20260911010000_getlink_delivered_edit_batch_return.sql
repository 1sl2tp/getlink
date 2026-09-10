-- Complete TAPHOA parity for delivered-order editing and filtered batch return.
-- No new tables. Delivered "delete" remains a return/reversal, never physical deletion.

create or replace function public.getlink_sales_update_delivered_order(
  p_id uuid,
  p_actor_id uuid,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order public.getlink_sales_orders%rowtype;
  v_item_count integer;
  v_total bigint;
  v_total_cost bigint;
begin
  if not exists(
    select 1 from public.v21_accounts
    where id=p_actor_id
      and role='admin'
      and deleted_at is null
      and locked_at is null
  ) then raise exception 'Admin required'; end if;

  select * into v_order
  from public.getlink_sales_orders
  where id=p_id
  for update;

  if v_order.id is null then raise exception 'Order not found'; end if;
  if v_order.status<>'delivered' then raise exception 'Only delivered orders can be edited'; end if;

  if jsonb_typeof(coalesce(p_items,'[]'::jsonb))<>'array' then
    raise exception 'Order items must be an array';
  end if;

  select count(*),
         coalesce(sum((x.item->>'unitPriceVnd')::bigint * (x.item->>'quantity')::numeric),0)::bigint,
         coalesce(sum((x.item->>'unitCostVnd')::bigint * (x.item->>'quantity')::numeric),0)::bigint
  into v_item_count,v_total,v_total_cost
  from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) x(item)
  where btrim(coalesce(x.item->>'productCode',''))<>''
    and btrim(coalesce(x.item->>'productName',''))<>''
    and coalesce((x.item->>'quantity')::numeric,0)>0
    and coalesce((x.item->>'unitPriceVnd')::bigint,-1)>=0
    and coalesce((x.item->>'unitCostVnd')::bigint,-1)>=0;

  if v_item_count=0 or v_item_count<>jsonb_array_length(coalesce(p_items,'[]'::jsonb)) then
    raise exception 'Invalid GETLINK order items';
  end if;

  delete from public.getlink_sales_order_items where order_id=p_id;
  insert into public.getlink_sales_order_items(
    order_id,line_no,product_code,product_name,product_url,quantity,
    unit_price_vnd,unit_cost_vnd,source_key
  )
  select p_id,x.ord::integer,
         btrim(x.item->>'productCode'),
         btrim(x.item->>'productName'),
         coalesce(x.item->>'productUrl',''),
         (x.item->>'quantity')::numeric,
         (x.item->>'unitPriceVnd')::bigint,
         (x.item->>'unitCostVnd')::bigint,
         coalesce(x.item->>'sourceKey','')
  from jsonb_array_elements(p_items) with ordinality x(item,ord);

  update public.getlink_sales_orders
  set total_amount_vnd=v_total,
      total_cost_vnd=v_total_cost,
      updated_at=now(),
      version=version+1
  where id=p_id;

  -- A delivered order owns one order_debt event. Editing the order changes that
  -- event amount in place so every later running balance reflects the new total.
  if v_total>0 then
    update public.getlink_debt_ledger
    set amount_vnd=v_total,
        note='Giao đơn #'||v_order.order_no
    where order_id=p_id and event_type='order_debt';

    if not found then
      insert into public.getlink_debt_ledger(
        customer_account_id,order_id,event_type,amount_vnd,direction,note,occurred_at,created_by_account_id
      ) values (
        v_order.customer_account_id,p_id,'order_debt',v_total,'increase',
        'Giao đơn #'||v_order.order_no,coalesce(v_order.delivered_at,now()),p_actor_id
      );
    end if;
  else
    delete from public.getlink_debt_ledger
    where order_id=p_id and event_type='order_debt';
  end if;

  return p_id;
end;
$function$;

create or replace function public.getlink_sales_return_delivered_scope(
  p_actor_id uuid,
  p_ids jsonb
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_order public.getlink_sales_orders%rowtype;
  v_count integer:=0;
begin
  if not exists(
    select 1 from public.v21_accounts
    where id=p_actor_id
      and role='admin'
      and deleted_at is null
      and locked_at is null
  ) then raise exception 'Admin required'; end if;

  if jsonb_typeof(coalesce(p_ids,'[]'::jsonb))<>'array' then
    raise exception 'Order ids must be an array';
  end if;

  for v_id in
    select distinct value::uuid
    from jsonb_array_elements_text(coalesce(p_ids,'[]'::jsonb)) as x(value)
  loop
    select * into v_order
    from public.getlink_sales_orders
    where id=v_id
    for update;

    if v_order.id is null then raise exception 'Order not found'; end if;
    if v_order.status<>'delivered' then raise exception 'Only delivered orders can be returned'; end if;

    if v_order.total_amount_vnd>0 then
      insert into public.getlink_debt_ledger(
        customer_account_id,order_id,event_type,amount_vnd,direction,note,occurred_at,created_by_account_id
      ) values (
        v_order.customer_account_id,v_id,'order_return_reversal',v_order.total_amount_vnd,'decrease',
        'Hoàn đơn #'||v_order.order_no,now(),p_actor_id
      ) on conflict do nothing;
    end if;

    update public.getlink_sales_orders
    set status='returned',returned_at=now(),updated_at=now(),version=version+1
    where id=v_id;

    v_count:=v_count+1;
  end loop;

  return v_count;
end;
$function$;

revoke all on function public.getlink_sales_update_delivered_order(uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.getlink_sales_return_delivered_scope(uuid,jsonb) from public,anon,authenticated;

grant execute on function public.getlink_sales_update_delivered_order(uuid,uuid,jsonb) to service_role;
grant execute on function public.getlink_sales_return_delivered_scope(uuid,jsonb) to service_role;
