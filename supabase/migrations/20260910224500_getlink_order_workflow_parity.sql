-- Complete the existing GETLINK sales core without creating another order system.
-- Pending edits preserve order id/order_no. User mutations are scoped to their own orders.

create or replace function public.getlink_sales_update_pending_order(
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
  v_actor_role text;
  v_order public.getlink_sales_orders%rowtype;
  v_item_count integer;
  v_total bigint;
  v_total_cost bigint;
begin
  select role into v_actor_role
  from public.v21_accounts
  where id=p_actor_id
    and role in ('user','admin')
    and deleted_at is null
    and locked_at is null;
  if v_actor_role is null then raise exception 'Invalid GETLINK actor'; end if;

  select * into v_order
  from public.getlink_sales_orders
  where id=p_id
  for update;
  if v_order.id is null then raise exception 'Order not found'; end if;
  if v_order.status<>'pending' then raise exception 'Only pending orders can be edited'; end if;
  if v_actor_role='user' and v_order.customer_account_id<>p_actor_id then
    raise exception 'User may only edit own pending order';
  end if;

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

  return p_id;
end;
$function$;

create or replace function public.getlink_sales_delete_pending_order(
  p_id uuid,
  p_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor_role text;
  v_order public.getlink_sales_orders%rowtype;
begin
  select role into v_actor_role
  from public.v21_accounts
  where id=p_actor_id
    and role in ('user','admin')
    and deleted_at is null
    and locked_at is null;
  if v_actor_role is null then raise exception 'Invalid GETLINK actor'; end if;

  select * into v_order
  from public.getlink_sales_orders
  where id=p_id
  for update;
  if v_order.id is null then raise exception 'Order not found'; end if;
  if v_order.status<>'pending' then raise exception 'Only pending orders can be deleted'; end if;
  if v_actor_role='user' and v_order.customer_account_id<>p_actor_id then
    raise exception 'User may only delete own pending order';
  end if;

  delete from public.getlink_sales_orders where id=p_id;
end;
$function$;

create or replace function public.getlink_sales_delete_all_pending(
  p_actor_id uuid
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor_role text;
  v_deleted integer:=0;
begin
  select role into v_actor_role
  from public.v21_accounts
  where id=p_actor_id
    and role in ('user','admin')
    and deleted_at is null
    and locked_at is null;
  if v_actor_role is null then raise exception 'Invalid GETLINK actor'; end if;

  if v_actor_role='user' then
    delete from public.getlink_sales_orders
    where status='pending' and customer_account_id=p_actor_id;
  else
    delete from public.getlink_sales_orders where status='pending';
  end if;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$function$;

create or replace function public.getlink_sales_create_quick_sale(
  p_order jsonb,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_creator_id uuid := (p_order->>'createdByAccountId')::uuid;
  v_id uuid;
begin
  if not exists(
    select 1 from public.v21_accounts
    where id=v_creator_id
      and role='admin'
      and deleted_at is null
      and locked_at is null
  ) then raise exception 'Admin required'; end if;

  v_id:=public.getlink_sales_create_order(p_order,p_items);
  perform public.getlink_sales_deliver_order(v_id,v_creator_id);
  return v_id;
end;
$function$;

revoke all on function public.getlink_sales_update_pending_order(uuid,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.getlink_sales_delete_pending_order(uuid,uuid) from public, anon, authenticated;
revoke all on function public.getlink_sales_delete_all_pending(uuid) from public, anon, authenticated;
revoke all on function public.getlink_sales_create_quick_sale(jsonb,jsonb) from public, anon, authenticated;

grant execute on function public.getlink_sales_update_pending_order(uuid,uuid,jsonb) to service_role;
grant execute on function public.getlink_sales_delete_pending_order(uuid,uuid) to service_role;
grant execute on function public.getlink_sales_delete_all_pending(uuid) to service_role;
grant execute on function public.getlink_sales_create_quick_sale(jsonb,jsonb) to service_role;
