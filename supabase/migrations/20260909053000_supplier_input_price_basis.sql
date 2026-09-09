-- Per-product supplier input price basis.
-- XLS can mark each product as Thùng (carton) or Lẻ (retail).
-- Changing this basis is not a supplier price increase/decrease.

alter table public.getlink_supplier_products
  add column if not exists input_price_basis text not null default 'carton';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='getlink_supplier_products_input_price_basis_check'
      and conrelid='public.getlink_supplier_products'::regclass
  ) then
    alter table public.getlink_supplier_products
      add constraint getlink_supplier_products_input_price_basis_check
      check (input_price_basis in ('carton','retail'));
  end if;
end $$;

create or replace function public.getlink_normalize_supplier_price_levels()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  supplier_cost bigint;
  expected_profit bigint;
  sell_price bigint;
  pack_qty numeric;
  unit_name text;
  price_basis text;
begin
  supplier_cost := new.input_price_vnd;
  price_basis := case when new.input_price_basis='retail' then 'retail' else 'carton' end;
  new.input_price_basis := price_basis;

  if tg_op='INSERT' then
    if new.margin_thousand is not null then
      new.expected_profit_vnd := round(new.margin_thousand * 1000)::bigint;
    else
      new.expected_profit_vnd := coalesce(new.expected_profit_vnd,0);
    end if;
  elsif new.margin_thousand is distinct from old.margin_thousand
    and new.margin_thousand is not null then
    new.expected_profit_vnd := round(new.margin_thousand * 1000)::bigint;
  else
    new.expected_profit_vnd := coalesce(new.expected_profit_vnd,old.expected_profit_vnd,0);
  end if;

  expected_profit := coalesce(new.expected_profit_vnd,0);
  pack_qty := case
    when new.units_per_carton is not null and new.units_per_carton >= 1
      then new.units_per_carton
    else null
  end;
  unit_name := nullif(btrim(coalesce(new.retail_unit,'')),'');

  if new.source_key='thuoc-la' and unit_name is null then
    unit_name := 'cây';
  end if;

  if supplier_cost is null or supplier_cost <= 0 then
    sell_price := null;
  elsif tg_op='INSERT' then
    sell_price := case
      when new.display_price_vnd is not null and new.display_price_vnd > 0
        then new.display_price_vnd
      else supplier_cost + expected_profit
    end;
  else
    sell_price := case
      when new.display_price_vnd is distinct from old.display_price_vnd
        and new.display_price_vnd is not null
        and new.display_price_vnd > 0
        then new.display_price_vnd
      when old.display_price_vnd is not null and old.display_price_vnd > 0
        then old.display_price_vnd
      else supplier_cost + expected_profit
    end;
  end if;

  new.display_price_vnd := sell_price;
  new.actual_profit_vnd := case
    when sell_price is not null and supplier_cost is not null
      then sell_price - supplier_cost
    else null
  end;

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

  new.retail_unit := coalesce(unit_name,'');

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

drop trigger if exists getlink_supplier_price_levels_before_write
  on public.getlink_supplier_products;

create trigger getlink_supplier_price_levels_before_write
before insert or update of
  source_key,input_price_vnd,input_price_basis,display_price_vnd,margin_thousand,
  expected_profit_vnd,units_per_carton,retail_unit,updated_at
on public.getlink_supplier_products
for each row
execute function public.getlink_normalize_supplier_price_levels();
