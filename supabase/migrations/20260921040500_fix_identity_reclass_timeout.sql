-- Avoid reclassifying the entire GETLINK catalog after every identity upsert.
-- Only re-evaluate the product whose identity row changed. Existing non-fallback
-- manual assignments remain sticky, matching the current application behavior.

create or replace function public.getlink_manual_group_identity_autosync()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_name text;
  v_group_key text;
  v_brand_hay text;
begin
  select l.name
    into v_name
  from public.getlink_links l
  where l.canonical_url = new.link_url
    and l.link_type = 'product'
    and coalesce(l.last_status,'') <> 'unlisted'
  limit 1;

  if v_name is null then
    return new;
  end if;

  -- Manual/non-fallback groups are intentionally sticky.
  if exists (
    select 1
    from public.getlink_manual_group_members m
    join public.getlink_manual_groups g on g.group_key = m.group_key
    where m.link_url = new.link_url
      and coalesce(g.is_fallback,false) = false
  ) then
    return new;
  end if;

  v_brand_hay := normalize(
    lower(
      concat_ws(
        ' ',
        coalesce(new.brand,''),
        coalesce(new.raw_brand,''),
        coalesce(new.bhx_brand_name,'')
      )
    ),
    NFC
  );

  select r.group_key
    into v_group_key
  from public.getlink_manual_group_rules r
  join public.getlink_manual_groups g
    on g.group_key = r.group_key
   and g.enabled = true
   and coalesce(g.is_fallback,false) = false
  where r.enabled = true
    and (
      (
        r.rule_type = 'brand_contains'
        and position(
          normalize(lower(btrim(r.rule_value)), NFC)
          in v_brand_hay
        ) > 0
      )
      or
      (
        r.rule_type <> 'brand_contains'
        and public.getlink_manual_group_rule_matches(v_name,r.rule_type,r.rule_value)
      )
    )
  order by g.sort_order asc, r.rule_order asc, length(r.rule_value) desc
  limit 1;

  delete from public.getlink_manual_group_members
  where link_url = new.link_url
    and group_key = 'chua-phan-loai';

  if v_group_key is not null then
    insert into public.getlink_manual_group_members(
      group_key,link_url,match_origin,matched_at
    )
    values(v_group_key,new.link_url,'rule',now())
    on conflict do nothing;
  else
    insert into public.getlink_manual_group_members(
      group_key,link_url,match_origin,matched_at
    )
    values('chua-phan-loai',new.link_url,'fallback',now())
    on conflict do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_getlink_manual_group_identity_autosync
  on public.getlink_source_product_identity;

create trigger trg_getlink_manual_group_identity_autosync
after insert or update of brand, raw_brand, bhx_brand_name
on public.getlink_source_product_identity
for each row
execute function public.getlink_manual_group_identity_autosync();
