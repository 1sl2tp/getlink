from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path, old, new, label):
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly 1 match, got {count}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


app = ROOT / "app.js"
replace_once(
    app,
    '''    .map(row=>({row,qty:userWorkQty(row.canonical_url)}))''',
    '''    .map(row=>({row,qty:userWorkQty(row.canonical_url),bargain:readOwnPrice(row.canonical_url,"bargain")}))''',
    "cart carries bargain",
)
replace_once(
    app,
    '''    const qty=Math.max(0,Math.round(Number(item?.qty||0)));
    const key=canonical(url);
    if(key&&qty>0)map[key]=qty;''',
    '''    const qty=Math.max(0,Math.round(Number(item?.qty||0)));
    const bargain=Math.max(0,Math.round(Number(item?.bargainPrice??item?.bargainPriceVnd??0)));
    const key=canonical(url);
    if(key&&qty>0){
      map[key]=qty;
      writeOwnPrice(url,"bargain",bargain);
    }''',
    "restore bargain while editing",
)

order = ROOT / "order-management.js"
replace_once(
    order,
    '''    return selected.map(item=>({url:item.row.canonical_url,qty:item.qty}));''',
    '''    return selected.map(item=>({
      url:item.row.canonical_url,
      qty:item.qty,
      bargainPriceVnd:Math.max(0,Math.round(Number(item.bargain||0)))
    }));''',
    "order payload bargain",
)
replace_once(
    order,
    '''  function orderRef(order){return order.orderNo?"#"+order.orderNo:String(order.id||"")}
  function orderRecencyValue(order){''',
    '''  function orderRef(order){return order.orderNo?"#"+order.orderNo:String(order.id||"")}
  function orderItemPriceMarkup(item){
    const sale=escapeHtml(compactMoney(item?.price));
    const bargainPrice=Number(item?.bargainPrice||0);
    return `<span class="order-item-prices"><span>Giá bán ${sale}</span>${bargainPrice>0?`<span> · Mặc cả ${escapeHtml(compactMoney(bargainPrice))}</span>`:""}</span>`;
  }
  function orderRecencyValue(order){''',
    "order item dual price helper",
)
replace_once(
    order,
    '''${expanded?`<div class="order-card-items">${items.map(item=>`<div><span>${escapeHtml(item.name)}</span><small>${Number(item.qty||0)} × ${escapeHtml(compactMoney(item.price))}</small></div>`).join("")}</div>`:""}''',
    '''${expanded?`<div class="order-card-items">${items.map(item=>`<div><span>${escapeHtml(item.name)}</span><small>${Number(item.qty||0)} × ${orderItemPriceMarkup(item)}</small></div>`).join("")}</div>`:""}''',
    "order detail dual prices",
)
replace_once(
    order,
    '''<div class="debt-linked-lines">${items.map((item,index)=>`<div><span><small>${index+1}.</small>${escapeHtml(item.name)}</span><span>${Number(item.qty||0)} × ${escapeHtml(compactMoney(item.price))}</span><strong>${escapeHtml(compactMoney(Number(item.qty||0)*Number(item.price||0)))}</strong></div>`).join("")}</div>''',
    '''<div class="debt-linked-lines">${items.map((item,index)=>`<div><span><small>${index+1}.</small>${escapeHtml(item.name)}</span><span>${Number(item.qty||0)} × ${orderItemPriceMarkup(item)}</span><strong>${escapeHtml(compactMoney(Number(item.qty||0)*Number(item.price||0)))}</strong></div>`).join("")}</div>''',
    "debt linked order dual prices",
)

edge = ROOT / "supabase/functions/getlink-orders/index.ts"
replace_once(
    edge,
    '''type CreateInput={url:string;qty:number};''',
    '''type CreateInput={url:string;qty:number;bargainPriceVnd:number};''',
    "create input bargain",
)
replace_once(
    edge,
    '''    price:Number(row.unit_price_vnd||0),
    sourceId:clean(row.source_key),''',
    '''    price:Number(row.unit_price_vnd||0),
    bargainPrice:Number(row.bargain_price_vnd||0),
    sourceId:clean(row.source_key),''',
    "item view bargain",
)
text = edge.read_text(encoding="utf-8")
old_select = '.select("id,order_id,line_no,product_code,product_name,product_url,quantity,unit_price_vnd,unit_cost_vnd,source_key")'
new_select = '.select("id,order_id,line_no,product_code,product_name,product_url,quantity,unit_price_vnd,bargain_price_vnd,unit_cost_vnd,source_key")'
count = text.count(old_select)
if count != 2:
    raise SystemExit(f"order item selects: expected exactly 2 matches, got {count}")
edge.write_text(text.replace(old_select, new_select), encoding="utf-8")
replace_once(
    edge,
    '''    const qty=Number(entry?.qty);
    const key=url.toLowerCase();
    if(!url||!Number.isInteger(qty)||qty<=0||qty>999)throw fail("Sản phẩm hoặc số lượng không hợp lệ");
    if(seen.has(key))throw fail("Sản phẩm bị trùng trong đơn");
    seen.add(key);requested.push({url,qty});''',
    '''    const qty=Number(entry?.qty);
    const bargainRaw=Number(entry?.bargainPriceVnd||0);
    const bargainPriceVnd=Number.isFinite(bargainRaw)?Math.max(0,Math.min(100000,Math.round(bargainRaw))):0;
    const key=url.toLowerCase();
    if(!url||!Number.isInteger(qty)||qty<=0||qty>999)throw fail("Sản phẩm hoặc số lượng không hợp lệ");
    if(seen.has(key))throw fail("Sản phẩm bị trùng trong đơn");
    seen.add(key);requested.push({url,qty,bargainPriceVnd});''',
    "sanitize bargain input",
)
replace_once(
    edge,
    '''    const price=Math.round(Number(row.display_price_vnd||0));
    const cost=Math.max(0,Math.round(Number(row.input_price_vnd||0)));
    if(!Number.isFinite(price)||price<=0)throw fail("Có sản phẩm chưa có giá bán");
    if(clean(row.stock_status)==="out_of_stock")throw fail("Có sản phẩm đang hết hàng");''',
    '''    const price=Math.max(0,Math.round(Number(row.display_price_vnd||0)));
    const cost=Math.max(0,Math.round(Number(row.input_price_vnd||0)));
    if(clean(row.stock_status)==="out_of_stock")throw fail("Có sản phẩm đang hết hàng");''',
    "allow zero selling price",
)
replace_once(
    edge,
    '''      quantity:request.qty,
      unitPriceVnd:price,
      unitCostVnd:Number.isFinite(cost)?cost:0,''',
    '''      quantity:request.qty,
      unitPriceVnd:price,
      bargainPriceVnd:request.bargainPriceVnd,
      unitCostVnd:Number.isFinite(cost)?cost:0,''',
    "resolved item bargain",
)

migration = ROOT / "supabase/migrations/20260911043000_getlink_order_bargain_snapshot.sql"
if migration.exists():
    raise SystemExit("bargain snapshot migration already exists")
migration.write_text(r'''begin;

-- Preserve an optional customer bargain price as an order-line snapshot.
-- Selling price remains the authoritative amount for totals and debt.
alter table public.getlink_sales_order_items
  add column if not exists bargain_price_vnd bigint;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname='getlink_sales_order_items_bargain_price_check'
      and conrelid='public.getlink_sales_order_items'::regclass
  ) then
    alter table public.getlink_sales_order_items
      add constraint getlink_sales_order_items_bargain_price_check
      check (bargain_price_vnd is null or bargain_price_vnd between 0 and 100000);
  end if;
end;
$$;

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
    and coalesce((x.item->>'unitCostVnd')::bigint,-1)>=0
    and coalesce((x.item->>'bargainPriceVnd')::bigint,0) between 0 and 100000;

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
    unit_price_vnd,bargain_price_vnd,unit_cost_vnd,source_key
  )
  select v_id,x.ord::integer,
         btrim(x.item->>'productCode'),
         btrim(x.item->>'productName'),
         coalesce(x.item->>'productUrl',''),
         (x.item->>'quantity')::numeric,
         (x.item->>'unitPriceVnd')::bigint,
         nullif(coalesce((x.item->>'bargainPriceVnd')::bigint,0),0),
         (x.item->>'unitCostVnd')::bigint,
         coalesce(x.item->>'sourceKey','')
  from jsonb_array_elements(p_items) with ordinality x(item,ord);

  return v_id;
end;
$$;

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
    and coalesce((x.item->>'unitCostVnd')::bigint,-1)>=0
    and coalesce((x.item->>'bargainPriceVnd')::bigint,0) between 0 and 100000;

  if v_item_count=0 or v_item_count<>jsonb_array_length(coalesce(p_items,'[]'::jsonb)) then
    raise exception 'Invalid GETLINK order items';
  end if;

  delete from public.getlink_sales_order_items where order_id=p_id;
  insert into public.getlink_sales_order_items(
    order_id,line_no,product_code,product_name,product_url,quantity,
    unit_price_vnd,bargain_price_vnd,unit_cost_vnd,source_key
  )
  select p_id,x.ord::integer,
         btrim(x.item->>'productCode'),
         btrim(x.item->>'productName'),
         coalesce(x.item->>'productUrl',''),
         (x.item->>'quantity')::numeric,
         (x.item->>'unitPriceVnd')::bigint,
         nullif(coalesce((x.item->>'bargainPriceVnd')::bigint,0),0),
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
    and coalesce((x.item->>'unitCostVnd')::bigint,-1)>=0
    and coalesce((x.item->>'bargainPriceVnd')::bigint,0) between 0 and 100000;

  if v_item_count=0 or v_item_count<>jsonb_array_length(coalesce(p_items,'[]'::jsonb)) then
    raise exception 'Invalid GETLINK order items';
  end if;

  delete from public.getlink_sales_order_items where order_id=p_id;
  insert into public.getlink_sales_order_items(
    order_id,line_no,product_code,product_name,product_url,quantity,
    unit_price_vnd,bargain_price_vnd,unit_cost_vnd,source_key
  )
  select p_id,x.ord::integer,
         btrim(x.item->>'productCode'),
         btrim(x.item->>'productName'),
         coalesce(x.item->>'productUrl',''),
         (x.item->>'quantity')::numeric,
         (x.item->>'unitPriceVnd')::bigint,
         nullif(coalesce((x.item->>'bargainPriceVnd')::bigint,0),0),
         (x.item->>'unitCostVnd')::bigint,
         coalesce(x.item->>'sourceKey','')
  from jsonb_array_elements(p_items) with ordinality x(item,ord);

  update public.getlink_sales_orders
  set total_amount_vnd=v_total,
      total_cost_vnd=v_total_cost,
      updated_at=now(),
      version=version+1
  where id=p_id;

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

revoke all on function public.getlink_sales_create_order(jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.getlink_sales_update_pending_order(uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.getlink_sales_update_delivered_order(uuid,uuid,jsonb) from public,anon,authenticated;

grant execute on function public.getlink_sales_create_order(jsonb,jsonb) to service_role;
grant execute on function public.getlink_sales_update_pending_order(uuid,uuid,jsonb) to service_role;
grant execute on function public.getlink_sales_update_delivered_order(uuid,uuid,jsonb) to service_role;

commit;
''', encoding="utf-8")

print("zero-price order + bargain snapshot patch applied")
