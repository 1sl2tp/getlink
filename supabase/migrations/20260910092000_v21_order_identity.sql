begin;

-- Chat (v21_accounts) becomes the canonical identity for new GETLINK sales.
-- Historical TAPHOA orders/debts remain untouched and continue using customer_id.
alter table public.orders
  add column if not exists chat_account_id uuid;

alter table public.debts
  add column if not exists chat_account_id uuid;

create index if not exists orders_chat_account_id_idx
  on public.orders(chat_account_id, ordered_at desc)
  where chat_account_id is not null;

create index if not exists debts_chat_account_id_idx
  on public.debts(chat_account_id, occurred_at desc)
  where chat_account_id is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname='orders_chat_account_id_fkey'
  ) then
    alter table public.orders
      add constraint orders_chat_account_id_fkey
      foreign key (chat_account_id) references public.v21_accounts(id)
      on update cascade on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint where conname='debts_chat_account_id_fkey'
  ) then
    alter table public.debts
      add constraint debts_chat_account_id_fkey
      foreign key (chat_account_id) references public.v21_accounts(id)
      on update cascade on delete restrict;
  end if;
end $$;

-- The old FK only accepts legacy public.accounts IDs. Replace it with a
-- dual-generation validator: legacy rows stay validated against accounts;
-- new GETLINK rows are validated against v21_accounts through chat_account_id.
alter table public.debts drop constraint if exists debts_customer_fkey_safety;

create or replace function public.getlink_validate_debt_customer_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.chat_account_id is not null then
    if new.customer_id <> 'v21:' || new.chat_account_id::text then
      raise exception 'Invalid v21 debt customer marker';
    end if;
    if not exists (
      select 1
      from public.v21_accounts a
      where a.id=new.chat_account_id
        and a.role='user'
        and a.deleted_at is null
        and a.locked_at is null
    ) then
      raise exception 'Invalid v21 debt customer';
    end if;
  else
    if not exists (select 1 from public.accounts a where a.id=new.customer_id) then
      raise exception 'Invalid legacy debt customer';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists getlink_validate_debt_customer_identity_trg on public.debts;
create trigger getlink_validate_debt_customer_identity_trg
before insert or update of customer_id,chat_account_id on public.debts
for each row execute function public.getlink_validate_debt_customer_identity();

create or replace function public.getlink_create_v21_order(p_order jsonb,p_items jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text := p_order->>'id';
  v_chat_account_id uuid := (p_order->>'chatAccountId')::uuid;
  v_customer_name text;
  v_customer_marker text := 'v21:' || v_chat_account_id::text;
  v_at timestamptz := (p_order->>'ngay')::timestamptz;
begin
  select coalesce(nullif(display_name,''),username)
  into v_customer_name
  from public.v21_accounts
  where id=v_chat_account_id
    and role='user'
    and deleted_at is null
    and locked_at is null;

  if v_customer_name is null then
    raise exception 'Invalid Chat customer';
  end if;

  insert into public.orders(
    id,customer_id,customer_name,chat_account_id,ordered_at,status,total_amount,total_cost
  ) values (
    v_id,v_customer_marker,v_customer_name,v_chat_account_id,v_at,'pending',
    coalesce((p_order->>'tongTien')::numeric,0),
    coalesce((p_order->>'tongVon')::numeric,0)
  );

  insert into public.order_items(
    order_id,product_id,product_name,qty,unit_price,unit_cost,source_id,group_name,note,line_no
  )
  select v_id,x.item->>'maSP',coalesce(x.item->>'ten',''),
         coalesce((x.item->>'sl')::numeric,0),coalesce((x.item->>'gia')::numeric,0),
         coalesce((x.item->>'von')::numeric,0),nullif(x.item->>'sourceId',''),
         coalesce(x.item->>'nhom',''),coalesce(x.item->>'ghiChu',''),x.ord::integer
  from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) with ordinality as x(item,ord);

  perform public.taphoa_write_audit(
    'create_v21_order','order',v_id,null,
    to_jsonb((select o from public.orders o where o.id=v_id))
  );
end;
$$;

create or replace function public.getlink_approve_v21_order(
  p_id text,p_ngay timestamptz,p_debt_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.orders%rowtype;
  v_new public.orders%rowtype;
begin
  select * into v_old from public.orders where id=p_id for update;
  if v_old.id is null then raise exception 'Order not found: %',p_id; end if;
  if v_old.chat_account_id is null then raise exception 'Order is not a v21 order: %',p_id; end if;
  if v_old.status='done' then return; end if;
  if v_old.status<>'pending' then raise exception 'Order is not pending: %',p_id; end if;

  update public.orders
  set status='done',ordered_at=p_ngay,updated_at=now(),version=version+1
  where id=p_id returning * into v_new;

  if not exists(
    select 1 from public.debts where order_id=p_id and event_kind='order_debt'
  ) then
    insert into public.debts(
      id,customer_id,customer_name,chat_account_id,amount,debt_type,
      occurred_at,note,order_id,event_kind
    ) values (
      p_debt_id,v_old.customer_id,v_old.customer_name,v_old.chat_account_id,
      v_old.total_amount,'no',p_ngay,'Duyệt '||p_id,p_id,'order_debt'
    );
  end if;

  perform public.taphoa_refresh_daily_summary(public.taphoa_business_date(p_ngay));
  perform public.taphoa_write_audit('approve_v21_order','order',p_id,to_jsonb(v_old),to_jsonb(v_new));
end;
$$;

create or replace function public.getlink_cancel_v21_order(
  p_id text,p_reverse_debt boolean,p_debt_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.orders%rowtype;
  v_new public.orders%rowtype;
  v_now timestamptz := now();
begin
  select * into v_old from public.orders where id=p_id for update;
  if v_old.id is null then raise exception 'Order not found: %',p_id; end if;
  if v_old.chat_account_id is null then raise exception 'Order is not a v21 order: %',p_id; end if;
  if v_old.status='returned' then return; end if;

  if v_old.status='pending' then
    delete from public.order_items where order_id=p_id;
    delete from public.orders where id=p_id;
    perform public.taphoa_write_audit('delete_pending_v21_order','order',p_id,to_jsonb(v_old),null);
    return;
  end if;

  if v_old.status<>'done' then raise exception 'Order cannot be returned: %',p_id; end if;

  if p_reverse_debt and not exists(
    select 1 from public.debts where order_id=p_id and event_kind='order_return_reversal'
  ) then
    insert into public.debts(
      id,customer_id,customer_name,chat_account_id,amount,debt_type,
      occurred_at,note,order_id,event_kind
    ) values (
      p_debt_id,v_old.customer_id,v_old.customer_name,v_old.chat_account_id,
      v_old.total_amount,'thu',v_now,'Huỷ đơn '||p_id,p_id,'order_return_reversal'
    );
  end if;

  update public.orders
  set status='returned',returned_at=v_now,returned_reason=null,updated_at=v_now,version=version+1
  where id=p_id returning * into v_new;

  perform public.taphoa_refresh_daily_summary(public.taphoa_business_date(v_old.ordered_at));
  perform public.taphoa_refresh_daily_summary(public.taphoa_business_date(v_now));
  perform public.taphoa_write_audit('return_v21_order','order',p_id,to_jsonb(v_old),to_jsonb(v_new));
end;
$$;

commit;
