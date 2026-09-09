-- Supplier XLS rows contain only name + one price.
-- Business interpretation belongs to GETLINK:
--   * thuoc-la: source price = retail price for 1 cây
--   * every other supplier source: source price = carton price
-- units_per_carton is our own configuration and is never inferred from the sheet.

alter table public.getlink_supplier_products
  add column if not exists units_per_carton numeric,
  add column if not exists retail_unit text not null default '';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname='getlink_supplier_products_units_per_carton_check'
      and conrelid='public.getlink_supplier_products'::regclass
  ) then
    alter table public.getlink_supplier_products
      add constraint getlink_supplier_products_units_per_carton_check
      check (units_per_carton is null or units_per_carton >= 1);
  end if;
end $$;

create or replace function public.getlink_normalize_supplier_price_levels()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  source_price bigint;
  pack_qty numeric;
  unit_name text;
begin
  source_price := coalesce(new.display_price_vnd, new.input_price_vnd);
  pack_qty := case
    when new.units_per_carton is not null and new.units_per_carton >= 1
      then new.units_per_carton
    else null
  end;
  unit_name := nullif(btrim(coalesce(new.retail_unit,'')),'');

  if new.source_key='thuoc-la' then
    unit_name := coalesce(unit_name,'cây');
    new.retail_unit := unit_name;
    new.retail_packaging := '1 ' || unit_name;
    new.retail_price_vnd := source_price;

    if pack_qty is not null and pack_qty > 1 and source_price is not null then
      new.carton_price_vnd := round(source_price * pack_qty)::bigint;
      new.primary_packaging := 'Thùng';
    else
      new.carton_price_vnd := null;
      new.primary_packaging := '1 ' || unit_name;
    end if;
  else
    new.retail_unit := coalesce(unit_name,'');
    new.primary_packaging := 'Thùng';
    new.carton_price_vnd := source_price;

    if pack_qty is not null and pack_qty > 1 and source_price is not null then
      new.retail_price_vnd := round(source_price / pack_qty)::bigint;
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
  source_key,
  input_price_vnd,
  display_price_vnd,
  units_per_carton,
  retail_unit
on public.getlink_supplier_products
for each row
execute function public.getlink_normalize_supplier_price_levels();

update public.getlink_supplier_products
set
  retail_unit = case when source_key='thuoc-la' then 'cây' else retail_unit end,
  input_price_vnd = input_price_vnd;
