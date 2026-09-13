begin;

create or replace function public.getlink_sales_create_manual_product(
  p_source_key text,
  p_product_name text,
  p_price_vnd bigint,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_key text := btrim(coalesce(p_source_key,''));
  v_source_name text;
  v_name text := regexp_replace(btrim(coalesce(p_product_name,'')), '[[:space:]]+', ' ', 'g');
  v_price bigint := coalesce(p_price_vnd,0);
  v_source_row integer;
  v_seq integer;
  v_prefix text;
  v_code text;
  v_url text;
  v_display bigint;
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

  select source_name
  into v_source_name
  from public.getlink_supplier_sources
  where source_key=v_source_key
    and enabled=true;
  if v_source_name is null then
    raise exception 'Invalid supplier source';
  end if;

  if char_length(v_name)<2 or char_length(v_name)>120 then
    raise exception 'Invalid product name';
  end if;
  if v_price<1 or v_price>1000000000 then
    raise exception 'Invalid product price';
  end if;

  perform pg_advisory_xact_lock(hashtext('getlink_supplier_manual:'||v_source_key));

  if exists(
    select 1
    from public.getlink_supplier_products
    where source_key=v_source_key
      and is_active=true
      and lower(regexp_replace(btrim(product_name), '[[:space:]]+', ' ', 'g'))=lower(v_name)
  ) then
    raise exception 'Product already exists';
  end if;

  v_prefix := case v_source_key
    when 'hang-thuong' then 'HT'
    when 'hang-u' then 'HU'
    when 'masan' then 'MAS'
    when 'sua' then 'SUA'
    when 'thuoc-la' then 'TL'
    else upper(left(regexp_replace(v_source_key, '[^a-zA-Z0-9]', '', 'g'), 3))
  end;
  if coalesce(v_prefix,'')='' then v_prefix:='SP'; end if;

  select coalesce(max(source_row),0)+1
  into v_source_row
  from public.getlink_supplier_products
  where source_key=v_source_key;

  select coalesce(max((substring(product_code from '([0-9]+)$'))::integer),0)+1
  into v_seq
  from public.getlink_supplier_products
  where source_key=v_source_key
    and product_code ~ '[0-9]+$';

  loop
    v_code := v_prefix||'-'||lpad(v_seq::text,6,'0');
    exit when not exists(select 1 from public.getlink_supplier_products where product_code=v_code);
    v_seq:=v_seq+1;
  end loop;

  v_url := 'https://get.taphoa.xyz/nguon-hang/'||v_source_key||'/'||v_code;

  insert into public.getlink_supplier_products(
    source_key,source_row,product_name,input_price_vnd,expected_profit_percent,
    applied_profit_vnd,input_price_basis,stock_status,stock_label,canonical_url,
    raw_row,product_code,is_active,imported_at,updated_at
  ) values (
    v_source_key,v_source_row,v_name,v_price,0,
    0,'carton','available','Có giá',v_url,
    jsonb_build_array(
      v_name,(v_price::numeric/1000),'Có giá','Thùng',0,0,0,
      'Thêm nhanh',(v_price::numeric/1000),'','','','','','',v_code
    ),
    v_code,true,now(),now()
  )
  returning display_price_vnd into v_display;

  return jsonb_build_object(
    'source_key',v_source_key,
    'source_name',v_source_name,
    'source_row',v_source_row,
    'product_code',v_code,
    'product_name',v_name,
    'canonical_url',v_url,
    'price_vnd',coalesce(v_display,v_price)
  );
end;
$$;

revoke all on function public.getlink_sales_create_manual_product(text,text,bigint,uuid) from public,anon,authenticated;
grant execute on function public.getlink_sales_create_manual_product(text,text,bigint,uuid) to service_role;

commit;
