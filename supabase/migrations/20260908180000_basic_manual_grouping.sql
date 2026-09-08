-- Basic manual grouping pass.
-- RAW/source fields remain untouched.
-- Real groups are exclusive; Chưa phân loại is a fallback pool that can be re-evaluated later.

alter table public.getlink_manual_groups
  add column if not exists sort_order integer not null default 1000;

alter table public.getlink_manual_groups
  add column if not exists is_fallback boolean not null default false;

alter table public.getlink_manual_group_rules
  drop constraint if exists getlink_manual_group_rules_type_check;

alter table public.getlink_manual_group_rules
  add constraint getlink_manual_group_rules_type_check
  check (
    rule_type in (
      'name_starts',
      'name_contains',
      'name_contains_all',
      'name_product_phrase',
      'name_product_pack_phrase',
      'name_pack_contains'
    )
  );

alter table public.getlink_manual_group_members
  drop constraint if exists getlink_manual_group_members_origin_check;

alter table public.getlink_manual_group_members
  add constraint getlink_manual_group_members_origin_check
  check (match_origin in ('rule','manual','fallback'));

delete from public.getlink_manual_group_members;
delete from public.getlink_manual_group_rules;

delete from public.getlink_manual_groups
where group_key not in (
  'dau-an','mi-chinh','ca-phe',
  'bot-giat','nuoc-giat','nuoc-xa','dau-goi','dau-xa','sua-tam',
  'kem-danh-rang','xit-phong','sap-thom','hat-nem','bot-canh','xa-bong',
  'lan-khu-mui','lau','tay','bia','sua-tuoi','sua-chua','sua-dac',
  'banh','keo','nuoc-ngot','chao','mi','duong','tuong','nuoc-mam',
  'xi-dau','nuoc-tuong','xuc-xich','chua-phan-loai'
);

insert into public.getlink_manual_groups(
  group_key,name,rule_type,rule_value,enabled,sort_order,is_fallback,updated_at
)
values
  ('dau-an','Dầu ăn','name_contains','dầu ăn',true,10,false,now()),
  ('mi-chinh','Mì chính','name_contains','mì chính',true,20,false,now()),
  ('ca-phe','Cà phê','name_contains','cà phê',true,30,false,now()),
  ('bot-giat','Bột giặt','name_contains','bột giặt',true,40,false,now()),
  ('nuoc-giat','Nước giặt','name_contains','nước giặt',true,50,false,now()),
  ('nuoc-xa','Nước xả','name_contains','nước xả',true,60,false,now()),
  ('dau-goi','Dầu gội','name_contains','dầu gội',true,70,false,now()),
  ('dau-xa','Dầu xả','name_contains','dầu xả',true,80,false,now()),
  ('sua-tam','Sữa tắm','name_contains','sữa tắm',true,90,false,now()),
  ('kem-danh-rang','Kem đánh răng','name_contains','kem đánh răng',true,100,false,now()),
  ('xit-phong','Xịt phòng','name_contains','xịt phòng',true,110,false,now()),
  ('sap-thom','Sáp thơm','name_contains','sáp thơm',true,120,false,now()),
  ('hat-nem','Hạt nêm','name_contains','hạt nêm',true,130,false,now()),
  ('bot-canh','Bột canh','name_contains','bột canh',true,140,false,now()),
  ('xa-bong','Xà bông','name_contains','xà bông',true,150,false,now()),
  ('lan-khu-mui','Lăn khử mùi','name_contains','lăn khử mùi',true,160,false,now()),
  ('lau','Lau','name_contains','nước lau',true,170,false,now()),
  ('tay','Tẩy','name_contains','nước tẩy',true,180,false,now()),
  ('bia','Bia','name_contains','bia',true,190,false,now()),
  ('sua-tuoi','Sữa tươi','name_contains','sữa tươi',true,200,false,now()),
  ('sua-chua','Sữa chua','name_contains','sữa chua',true,210,false,now()),
  ('sua-dac','Sữa đặc','name_contains','sữa đặc',true,220,false,now()),
  ('banh','Bánh','name_contains','bánh',true,230,false,now()),
  ('keo','Kẹo','name_contains','kẹo',true,240,false,now()),
  ('nuoc-ngot','Nước ngọt','name_contains','nước ngọt',true,250,false,now()),
  ('chao','Cháo','name_contains','cháo',true,260,false,now()),
  ('mi','Mì','name_contains','mì',true,270,false,now()),
  ('duong','Đường','name_contains','đường',true,280,false,now()),
  ('tuong','Tương','name_contains','tương',true,290,false,now()),
  ('nuoc-mam','Nước mắm','name_contains','nước mắm',true,300,false,now()),
  ('xi-dau','Xì dầu','name_contains','xì dầu',true,310,false,now()),
  ('nuoc-tuong','Nước tương','name_contains','nước tương',true,320,false,now()),
  ('xuc-xich','Xúc xích','name_contains','xúc xích',true,330,false,now()),
  ('chua-phan-loai','Chưa phân loại','name_contains','fallback',true,9999,true,now())
on conflict (group_key) do update
set name=excluded.name,
    enabled=excluded.enabled,
    sort_order=excluded.sort_order,
    is_fallback=excluded.is_fallback,
    updated_at=now();

insert into public.getlink_manual_group_rules(
  group_key,rule_type,rule_value,rule_order,enabled
)
values
  ('dau-an','name_starts','dầu ăn',10,true),
  ('mi-chinh','name_starts','mì chính',10,true),
  ('mi-chinh','name_starts','bột ngọt',20,true),
  ('ca-phe','name_starts','cà phê',10,true),
  ('ca-phe','name_starts','cafe',20,true),
  ('ca-phe','name_starts','café',30,true),
  ('ca-phe','name_starts','caffe',40,true),
  ('bot-giat','name_starts','bột giặt',10,true),
  ('nuoc-giat','name_starts','nước giặt',10,true),
  ('nuoc-xa','name_starts','nước xả',10,true),
  ('dau-goi','name_starts','dầu gội',10,true),
  ('dau-xa','name_starts','dầu xả',10,true),
  ('sua-tam','name_starts','sữa tắm',10,true),
  ('kem-danh-rang','name_starts','kem đánh răng',10,true),
  ('xit-phong','name_starts','xịt phòng',10,true),
  ('xit-phong','name_starts','nước xịt phòng',20,true),
  ('xit-phong','name_starts','xịt thơm phòng',30,true),
  ('sap-thom','name_starts','sáp thơm',10,true),
  ('hat-nem','name_starts','hạt nêm',10,true),
  ('bot-canh','name_starts','bột canh',10,true),
  ('xa-bong','name_starts','xà bông',10,true),
  ('xa-bong','name_starts','xà phòng',20,true),
  ('lan-khu-mui','name_starts','lăn khử mùi',10,true),
  ('lan-khu-mui','name_starts','lăn nách',20,true),
  ('lau','name_starts','nước lau',10,true),
  ('lau','name_starts','dung dịch lau',20,true),
  ('lau','name_starts','lau ',30,true),
  ('tay','name_starts','nước tẩy',10,true),
  ('tay','name_starts','dung dịch tẩy',20,true),
  ('tay','name_starts','tẩy ',30,true),
  ('bia','name_starts','bia',10,true),
  ('sua-tuoi','name_starts','sữa tươi',10,true),
  ('sua-chua','name_starts','sữa chua',10,true),
  ('sua-chua','name_contains','probi',20,true),
  ('sua-chua','name_contains_all','sữa|lên men',30,true),
  ('sua-dac','name_starts','sữa đặc',10,true),
  ('banh','name_starts','bánh',10,true),
  ('keo','name_starts','kẹo',10,true),
  ('nuoc-ngot','name_starts','nước ngọt',10,true),
  ('chao','name_starts','cháo',10,true),
  ('mi','name_starts','mì',10,true),
  ('duong','name_starts','đường',10,true),
  ('tuong','name_starts','tương',10,true),
  ('nuoc-mam','name_starts','nước mắm',10,true),
  ('xi-dau','name_starts','xì dầu',10,true),
  ('nuoc-tuong','name_starts','nước tương',10,true),
  ('nuoc-tuong','name_starts','dầu hào',20,true),
  ('nuoc-tuong','name_starts','maggi nước tương',30,true),
  ('nuoc-tuong','name_starts','magi nước tương',40,true),
  ('nuoc-tuong','name_starts','maggi dầu hào',50,true),
  ('nuoc-tuong','name_starts','magi dầu hào',60,true),
  ('xuc-xich','name_starts','xúc xích',10,true);

with p as (
  select l.canonical_url,normalize(lower(l.name),NFC) as n
  from public.getlink_links l
  where l.link_type='product' and l.last_status<>'unlisted'
),
classified as (
  select canonical_url,
    case
      when n like 'dầu ăn%' then 'dau-an'
      when n like 'mì chính%' or n like 'bột ngọt%' then 'mi-chinh'
      when n like 'cà phê%' or n like 'cafe%' or n like 'café%' or n like 'caffe%' then 'ca-phe'
      when n like 'bột giặt%' then 'bot-giat'
      when n like 'nước giặt%' then 'nuoc-giat'
      when n like 'nước xả%' then 'nuoc-xa'
      when n like 'dầu gội%' then 'dau-goi'
      when n like 'dầu xả%' then 'dau-xa'
      when n like 'sữa tắm%' then 'sua-tam'
      when n like 'kem đánh răng%' then 'kem-danh-rang'
      when n like 'xịt phòng%' or n like 'nước xịt phòng%' or n like 'xịt thơm phòng%' then 'xit-phong'
      when n like 'sáp thơm%' then 'sap-thom'
      when n like 'hạt nêm%' then 'hat-nem'
      when n like 'bột canh%' then 'bot-canh'
      when n like 'xà bông%' or n like 'xà phòng%' then 'xa-bong'
      when n like 'lăn khử mùi%' or n like 'lăn nách%' then 'lan-khu-mui'
      when n like 'nước lau%' or n like 'dung dịch lau%' or n like 'lau %' then 'lau'
      when n like 'nước tẩy%' or n like 'dung dịch tẩy%' or n like 'tẩy %' then 'tay'
      when n like 'bia%' then 'bia'
      when n like 'sữa tươi%' then 'sua-tuoi'
      when n like 'sữa chua%' or n like '%probi%' or (n like '%sữa%' and n like '%lên men%') then 'sua-chua'
      when n like 'sữa đặc%' then 'sua-dac'
      when n like 'bánh%' then 'banh'
      when n like 'kẹo%' then 'keo'
      when n like 'nước ngọt%' then 'nuoc-ngot'
      when n like 'cháo%' then 'chao'
      when n like 'mì%' then 'mi'
      when n like 'đường%' then 'duong'
      when n like 'tương%' then 'tuong'
      when n like 'nước mắm%' then 'nuoc-mam'
      when n like 'xì dầu%' then 'xi-dau'
      when n like 'nước tương%'
        or n like 'dầu hào%'
        or n like 'maggi nước tương%'
        or n like 'magi nước tương%'
        or n like 'maggi dầu hào%'
        or n like 'magi dầu hào%' then 'nuoc-tuong'
      when n like 'xúc xích%' then 'xuc-xich'
      else 'chua-phan-loai'
    end as group_key
  from p
)
insert into public.getlink_manual_group_members(group_key,link_url,match_origin,matched_at)
select group_key,canonical_url,
  case when group_key='chua-phan-loai' then 'fallback' else 'rule' end,
  now()
from classified
on conflict do nothing;
