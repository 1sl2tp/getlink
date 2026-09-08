-- Canonical brand registry for GETLINK.
-- Every GET/refresh resolves brand aliases before persistence.
-- Existing case/spacing/punctuation/accent variants are backfilled once.

create extension if not exists unaccent with schema extensions;

create or replace function public.getlink_brand_key(value text)
returns text
language sql
stable
as $$
  select regexp_replace(
    lower(extensions.unaccent(coalesce(value,''))),
    '[^a-z0-9]+',
    '',
    'g'
  );
$$;

create table if not exists public.getlink_brand_aliases (
  brand_key text primary key,
  canonical_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint getlink_brand_aliases_key_nonempty check (brand_key <> ''),
  constraint getlink_brand_aliases_name_nonempty check (btrim(canonical_name) <> '')
);

alter table public.getlink_brand_aliases enable row level security;
revoke all on table public.getlink_brand_aliases from anon, authenticated;

with raw_variants as (
  select btrim(brand) as raw_brand
  from public.getlink_source_product_identity
  where nullif(btrim(brand),'') is not null

  union all

  select btrim(branch_name) as raw_brand
  from public.getlink_links
  where link_type='product'
    and nullif(btrim(branch_name),'') is not null

  union all

  select btrim(bhx_brand_name) as raw_brand
  from public.getlink_source_product_identity
  where nullif(btrim(bhx_brand_name),'') is not null
),
variant_counts as (
  select
    public.getlink_brand_key(raw_brand) as brand_key,
    raw_brand,
    count(*)::bigint as n
  from raw_variants
  where public.getlink_brand_key(raw_brand) <> ''
  group by public.getlink_brand_key(raw_brand),raw_brand
),
ranked as (
  select
    brand_key,
    raw_brand,
    n,
    row_number() over (
      partition by brand_key
      order by
        n desc,
        case when raw_brand=upper(raw_brand) and length(raw_brand)>4 then 1 else 0 end,
        length(raw_brand),
        raw_brand
    ) as rn
  from variant_counts
)
insert into public.getlink_brand_aliases(brand_key,canonical_name,updated_at)
select brand_key,raw_brand,now()
from ranked
where rn=1
on conflict (brand_key) do nothing;

update public.getlink_links l
set branch_name=a.canonical_name,
    updated_at=now()
from public.getlink_brand_aliases a
where l.link_type='product'
  and nullif(btrim(l.branch_name),'') is not null
  and public.getlink_brand_key(l.branch_name)=a.brand_key
  and l.branch_name is distinct from a.canonical_name;

update public.getlink_source_product_identity i
set brand=a.canonical_name,
    updated_at=now()
from public.getlink_brand_aliases a
where nullif(btrim(i.brand),'') is not null
  and public.getlink_brand_key(i.brand)=a.brand_key
  and i.brand is distinct from a.canonical_name;

update public.getlink_source_product_identity i
set bhx_brand_name=a.canonical_name,
    updated_at=now()
from public.getlink_brand_aliases a
where nullif(btrim(i.bhx_brand_name),'') is not null
  and public.getlink_brand_key(i.bhx_brand_name)=a.brand_key
  and i.bhx_brand_name is distinct from a.canonical_name;
