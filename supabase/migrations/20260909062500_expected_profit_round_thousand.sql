-- Round percentage-based expected profit to the nearest thousand VND.
-- This keeps source-sheet prices in the same thousand-VND granularity used by the business.

create or replace function public.getlink_normalize_supplier_price_levels()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  supplier_cost bigint;
  expected_profit bigint;
  applied_profit bigint;
  selected_profit bigint;
  sell_price bigint;
  pack_qty numeric;
  unit_name text;
  price_basis text;
  profit_mode text;
  expected_percent numeric;
begin
  supplier_cost := new.input_price_vnd;
  price_basis := case when new.input_price_basis='retail' then 'retail' else 'carton' end;
  new.input_price_basis := price_basis;

  expected_percent := case
    when new.expected_profit_percent is null then null
    when new.expected_profit_percent < 0 then 0
    when new.expected_profit_percent > 100 then 100
    else new.expected_profit_percent
  end;
  new.expected_profit_percent := expected_percent;

  expected_profit := case
    when supplier_cost is not null and supplier_cost > 0 and expected_percent is not null
      then round((supplier_cost::numeric * expected_percent / 100.0) / 1000.0)::bigint * 1000
    else 0
  end;
  new.expected_profit_vnd := expected_profit;
  new.margin_thousand := expected_profit::numeric / 1000.0;

  applied_profit := new.applied_profit_vnd;
  profit_mode := case
    when new.pricing_profit_mode='applied' and applied_profit is not null then 'applied'
    else 'expected'
  end;
  new.pricing_profit_mode := profit_mode;
  selected_profit := case when profit_mode='applied' then applied_profit else expected_profit end;

  if supplier_cost is null or supplier_cost <= 0 then
    sell_price := null;
  else
    sell_price := supplier_cost + coalesce(selected_profit,0);
  end if;

  new.display_price_vnd := sell_price;
  new.actual_profit_vnd := case
    when sell_price is not null and supplier_cost is not null
      then sell_price - supplier_cost
    else null
  end;

  pack_qty := case
    when new.units_per_carton is not null and new.units_per_carton >= 1
      then new.units_per_carton
    else null
  end;
  unit_name := nullif(btrim(coalesce(new.retail_unit,'')),'');
  if new.source_key='thuoc-la' and unit_name is null then
    unit_name := 'cây';
  end if;
  new.retail_unit := coalesce(unit_name,'');

  if tg_op='INSERT' then
    new.previous_input_price_vnd := null;
    new.supplier_price_delta_vnd := null;
    new.supplier_price_direction := null;
    new.supplier_price_changed_at := coalesce(new.imported_at, now());
    new.supplier_price_last_seen_at := coalesce(new.updated_at, now());
  else
    new.supplier_price_last_seen_at := coalesce(new.updated_at, now());
    if new.input_price_vnd is distinct from old.input_price_vnd then
      new.previous_input_price_vnd := old.input_price_vnd;
      if new.input_price_vnd is not null and old.input_price_vnd is not null then
        new.supplier_price_delta_vnd := new.input_price_vnd - old.input_price_vnd;
        new.supplier_price_direction := case
          when new.input_price_vnd > old.input_price_vnd then 'up'
          when new.input_price_vnd < old.input_price_vnd then 'down'
          else null
        end;
      else
        new.supplier_price_delta_vnd := null;
        new.supplier_price_direction := null;
      end if;
      new.supplier_price_changed_at := now();
    end if;
  end if;

  if price_basis='retail' then
    new.retail_price_vnd := sell_price;
    new.retail_packaging := case
      when unit_name is not null then '1 ' || unit_name
      else 'Lẻ'
    end;
    if pack_qty is not null and pack_qty > 1 and sell_price is not null then
      new.carton_price_vnd := round(sell_price * pack_qty)::bigint;
      new.primary_packaging := 'Thùng';
    else
      new.carton_price_vnd := null;
      new.primary_packaging := case
        when unit_name is not null then '1 ' || unit_name
        else 'Lẻ'
      end;
    end if;
  else
    new.primary_packaging := 'Thùng';
    new.carton_price_vnd := sell_price;
    if pack_qty is not null and pack_qty > 1 and sell_price is not null then
      new.retail_price_vnd := round(sell_price / pack_qty)::bigint;
      new.retail_packaging := '1 ' || coalesce(unit_name,'lẻ');
    else
      new.retail_price_vnd := null;
      new.retail_packaging := case
        when unit_name is not null then '1 ' || unit_name
        else ''
      end;
    end if;
  end if;

  return new;
end;
$$;
