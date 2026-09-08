-- Rebuild manual grouping from source product names.
-- Rule: ignore only technical prefixes (code / package quantity) at the beginning,
-- then classify by the first meaningful catalog phrase. RAW product names remain untouched.

delete from public.getlink_manual_group_rules;

insert into public.getlink_manual_group_rules(
  group_key,rule_type,rule_value,rule_order,enabled
)
select group_key,'name_starts',btrim(name),10,true
from public.getlink_manual_groups
where enabled=true
  and coalesce(is_fallback,false)=false;

delete from public.getlink_manual_group_members;

with source_rows as (
  select
    l.canonical_url,
    normalize(lower(btrim(coalesce(l.name,''))), NFC) as raw_name
  from public.getlink_links l
  where l.link_type='product'
    and coalesce(l.last_status,'')<>'unlisted'
    and btrim(coalesce(l.canonical_url,''))<>''
),
clean_code as (
  select
    canonical_url,
    regexp_replace(
      raw_name,
      '^(mã|ma|sku|msp|code|sp)[[:space:]]*((sản phẩm|hàng)[[:space:]]*)?[:#._-]*[[:space:]]*[a-z0-9][a-z0-9._/-]{1,40}[[:space:]]*([-–—:;|·][[:space:]]*)?',
      '',
      'i'
    ) as n
  from source_rows
),
clean_bare_code as (
  select
    canonical_url,
    regexp_replace(
      n,
      '^([0-9]{6,}|[a-z]{1,4}[0-9]{4,})[[:space:]]*([-–—:;|·][[:space:]]*)?',
      '',
      'i'
    ) as n
  from clean_code
),
clean_pack as (
  select
    canonical_url,
    regexp_replace(
      n,
      '^(thùng|lốc|lô|vỉ|vĩ|khay)[[:space:]]+[0-9]+([[:space:]]*(\+|x|×)[[:space:]]*[0-9]+)*([[:space:]]+(chai|lon|hộp|hũ|túi|gói|bịch|lọ|can|miếng|thanh|viên|cái|cây|bộ|đôi|tuýp|ly|tô|bình|lốc|vỉ|khay))?[[:space:]]+',
      '',
      'i'
    ) as n
  from clean_bare_code
),
groups as (
  select
    g.group_key,
    normalize(lower(btrim(g.name)), NFC) as prefix,
    g.sort_order
  from public.getlink_manual_groups g
  where g.enabled=true
    and coalesce(g.is_fallback,false)=false
),
ranked as (
  select
    p.canonical_url,
    g.group_key,
    row_number() over(
      partition by p.canonical_url
      order by g.sort_order asc,length(g.prefix) desc
    ) as rn
  from clean_pack p
  join groups g on starts_with(btrim(p.n),g.prefix)
),
chosen as (
  select canonical_url,group_key
  from ranked
  where rn=1
)
insert into public.getlink_manual_group_members(
  group_key,link_url,match_origin,matched_at
)
select
  coalesce(c.group_key,'chua-phan-loai'),
  p.canonical_url,
  case when c.group_key is null then 'fallback' else 'rule' end,
  now()
from source_rows p
left join chosen c on c.canonical_url=p.canonical_url;
