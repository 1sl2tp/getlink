begin;

-- GETLINK Tạp hóa native sales core.
-- New business data only: no legacy TAPHOA data is migrated or modified.

create table if not exists public.getlink_sales_orders (
  id uuid primary key default gen_random_uuid(),
  order_no bigint generated always as identity unique,
  customer_account_id uuid not null references public.v21_accounts(id) on update cascade on delete restrict,
  created_by_account_id uuid not null references public.v21_accounts(id) on update cascade on delete restrict,
  created_by_role text not null check (created_by_role in ('user','admin')),
  status text not null default 'pending' check (status in ('pending','delivered','returned')),
  total_amount_vnd bigint not null default 0 check (total_amount_vnd >= 0),
  total_cost_vnd bigint not null default 0 check (total_cost_vnd >= 0),
  submitted_at timestamptz not null default now(),
  delivered_at timestamptz,
  returned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1)
);

create index if not exists getlink_sales_orders_customer_status_idx
  on public.getlink_sales_orders(customer_account_id,status,submitted_at desc);
create index if not exists getlink_sales_orders_status_submitted_idx
  on public.getlink_sales_orders(status,submitted_at desc);

create table if not exists public.getlink_sales_order_items (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.getlink_sales_orders(id) on delete cascade,
  line_no integer not null check (line_no > 0),
  product_code text not null check (btrim(product_code) <> ''),
  product_name text not null check (btrim(product_name) <> ''),
  product_url text not null default '',
  quantity numeric not null check (quantity > 0),
  unit_price_vnd bigint not null check (unit_price_vnd >= 0),
  unit_cost_vnd bigint not null default 0 check (unit_cost_vnd >= 0),
  source_key text not null default '',
  created_at timestamptz not null default now(),
  unique(order_id,line_no)
);

create index if not exists getlink_sales_order_items_order_idx
  on public.getlink_sales_order_items(order_id,line_no);
create index if not exists getlink_sales_order_items_product_idx
  on public.getlink_sales_order_items(product_code);

create table if not exists public.getlink_debt_ledger (
  id uuid primary key default gen_random_uuid(),
  customer_account_id uuid not null references public.v21_accounts(id) on update cascade on delete restrict,
  order_id uuid references public.getlink_sales_orders(id) on delete restrict,
  event_type text not null check (event_type in ('order_debt','payment','order_return_reversal','manual_adjustment')),
  amount_vnd bigint not null check (amount_vnd > 0),
  direction text not null check (direction in ('increase','decrease')),
  note text not null default '',
  occurred_at timestamptz not null default now(),
  created_by_account_id uuid not null references public.v21_accounts(id) on update cascade on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists getlink_debt_ledger_customer_time_idx
  on public.getlink_debt_ledger(customer_account_id,occurred_at,id);
create index if not exists getlink_debt_ledger_order_idx
  on public.getlink_debt_ledger(order_id)
  where order_id is not null;
create unique index if not exists getlink_debt_one_order_debt_idx
  on public.getlink_debt_ledger(order_id)
  where event_type='order_debt';
create unique index if not exists getlink_debt_one_return_reversal_idx
  on public.getlink_debt_ledger(order_id)
  where event_type='order_return_reversal';

alter table public.getlink_sales_orders enable row level security;
alter table public.getlink_sales_order_items enable row level security;
alter table public.getlink_debt_ledger enable row level security;

create or replace function public.getlink_sales_create_order(p_order jsonb,p_items jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := coalesce(nullif(p_order->>'id','')::uuid,gen_random_uuid());
  v_customer_id uuid := (p_order->>'customerAccountId')::uuid;
  v_creator_id uuid := (p_order->>'createdByAccountId')::uuid;
  v_creator_role text;
  v_item_count integer;
  v_total bigint;
  v_total_cost bigint;
begin
  select role into v_creator_role
  from public.v21_accounts
  where id=v_creator_id
    and role in ('user','admin')
    and deleted_at is null
    and locked_at is null;
  if v_creator_role is null then raise exception 'Invalid GETLINK creator'; end if;

  if not exists(
    select 1 from public.v21_accounts
    where id=v_customer_id and role='user' and deleted_at is null and locked_at is null
  ) then raise exception 'Invalid GETLINK customer'; end if;

  if v_creator_role='user' and v_creator_id<>v_customer_id then
    raise exception 'User may only create an order for self';
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

  insert into public.getlink_sales_orders(
    id,customer_account_id,created_by_account_id,created_by_role,status,
    total_amount_vnd,total_cost_vnd,submitted_at
  ) values (
    v_id,v_customer_id,v_creator_id,v_creator_role,'pending',
    v_total,v_total_cost,coalesce((p_order->>'submittedAt')::timestamptz,now())
  );

  insert into public.getlink_sales_order_items(
    order_id,line_no,product_code,product_name,product_url,quantity,
    unit_price_vnd,unit_cost_vnd,source_key
  )
  select v_id,x.ord::integer,
         btrim(x.item->>'productCode'),
         btrim(x.item->>'productName'),
         coalesce(x.item->>'productUrl',''),
         (x.item->>'quantity')::numeric,
         (x.item->>'unitPriceVnd')::bigint,
         (x.item->>'unitCostVnd')::bigint,
         coalesce(x.item->>'sourceKey','')
  from jsonb_array_elements(p_items) with ordinality x(item,ord);

  return v_id;
end;
$$;

create or replace function public.getlink_sales_deliver_order(p_id uuid,p_actor_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.getlink_sales_orders%rowtype;
begin
  if not exists(
    select 1 from public.v21_accounts
    where id=p_actor_id and role='admin' and deleted_at is null and locked_at is null
  ) then raise exception 'Admin required'; end if;

  select * into v_order
  from public.getlink_sales_orders
  where id=p_id
  for update;
  if v_order.id is null then raise exception 'Order not found'; end if;
  if v_order.status='delivered' then return; end if;
  if v_order.status<>'pending' then raise exception 'Order is not pending'; end if;

  update public.getlink_sales_orders
  set status='delivered',delivered_at=now(),updated_at=now(),version=version+1
  where id=p_id;

  if v_order.total_amount_vnd>0 then
    insert into public.getlink_debt_ledger(
      customer_account_id,order_id,event_type,amount_vnd,direction,note,occurred_at,created_by_account_id
    ) values (
      v_order.customer_account_id,p_id,'order_debt',v_order.total_amount_vnd,'increase',
      'Giao đơn #'||v_order.order_no,now(),p_actor_id
    ) on conflict do nothing;
  end if;
end;
$$;

create or replace function public.getlink_sales_return_order(p_id uuid,p_actor_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.getlink_sales_orders%rowtype;
begin
  if not exists(
    select 1 from public.v21_accounts
    where id=p_actor_id and role='admin' and deleted_at is null and locked_at is null
  ) then raise exception 'Admin required'; end if;

  select * into v_order
  from public.getlink_sales_orders
  where id=p_id
  for update;
  if v_order.id is null then raise exception 'Order not found'; end if;
  if v_order.status='returned' then return; end if;

  if v_order.status='pending' then
    delete from public.getlink_sales_orders where id=p_id;
    return;
  end if;

  if v_order.status<>'delivered' then raise exception 'Order cannot be returned'; end if;

  if v_order.total_amount_vnd>0 then
    insert into public.getlink_debt_ledger(
      customer_account_id,order_id,event_type,amount_vnd,direction,note,occurred_at,created_by_account_id
    ) values (
      v_order.customer_account_id,p_id,'order_return_reversal',v_order.total_amount_vnd,'decrease',
      'Hoàn đơn #'||v_order.order_no,now(),p_actor_id
    ) on conflict do nothing;
  end if;

  update public.getlink_sales_orders
  set status='returned',returned_at=now(),updated_at=now(),version=version+1
  where id=p_id;
end;
$$;

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

  insert into public.getlink_debt_ledger(
    id,customer_account_id,event_type,amount_vnd,direction,note,occurred_at,created_by_account_id
  ) values (
    v_id,p_customer_id,'payment',p_amount_vnd,'decrease',coalesce(p_note,''),now(),p_actor_id
  );
  return v_id;
end;
$$;

revoke all on function public.getlink_sales_create_order(jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.getlink_sales_deliver_order(uuid,uuid) from public,anon,authenticated;
revoke all on function public.getlink_sales_return_order(uuid,uuid) from public,anon,authenticated;
revoke all on function public.getlink_sales_record_payment(uuid,bigint,uuid,text) from public,anon,authenticated;

grant execute on function public.getlink_sales_create_order(jsonb,jsonb) to service_role;
grant execute on function public.getlink_sales_deliver_order(uuid,uuid) to service_role;
grant execute on function public.getlink_sales_return_order(uuid,uuid) to service_role;
grant execute on function public.getlink_sales_record_payment(uuid,bigint,uuid,text) to service_role;

commit;
