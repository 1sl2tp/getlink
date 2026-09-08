import fs from "node:fs";
import assert from "node:assert/strict";

const source = fs.readFileSync("supabase/functions/getlink-api/index.ts", "utf8");
const brandMigration = fs.readFileSync("supabase/migrations/20260908163000_brand_canonical_registry.sql","utf8");
const sourceManagerMigration = fs.readFileSync("supabase/migrations/20260908164000_source_manager_raw_fields.sql","utf8");
const rawMigration = fs.readFileSync("supabase/migrations/20260908165000_immutable_raw_fetches.sql","utf8");
const manualGroupMigration = fs.readFileSync("supabase/migrations/20260908170000_manual_product_groups.sql","utf8");
const manualRulesMigration = fs.readFileSync("supabase/migrations/20260908171000_manual_group_multi_rules.sql","utf8");
const miChinhMigration = fs.readFileSync("supabase/migrations/20260908172000_manual_group_mi_chinh.sql","utf8");
const exclusiveCoffeeMigration = fs.readFileSync("supabase/migrations/20260908173000_manual_group_exclusive_coffee.sql","utf8");
const banhMigration = fs.readFileSync("supabase/migrations/20260908174000_manual_group_banh.sql","utf8");
const suaChuaMigration = fs.readFileSync("supabase/migrations/20260908175000_manual_group_sua_chua.sql","utf8");

assert.match(source, /function keepGetlinkProduct\(p: Product\)/);
assert.match(source, /comboHay/);
assert.match(source, /product_blocked_by_name_rule/);
assert.match(source, /filterGetlinkProducts\(raw\.items\.map\(\(x:any\)=>normalizeWinmart/);
assert.match(source, /filterGetlinkProducts\(raw\.items\.map\(\(x:any\)=>normalizeBhx/);
assert.match(source, /filterGetlinkProducts\(raw\.items\.map\(\(x:any\)=>normalizeGo/);

// Numeric+text may survive only when its numeric-leading prefix is the
// source brand (spacing/punctuation compacted), e.g. 3 Miền / 7 Up / 7UP.
assert.match(source, /isNumericBrandException\(name,brand\)/);
assert.match(source, /nc\.startsWith\(bc\)/);


// Running jobs abandoned by interrupted Edge executions must not stay running forever.
assert.match(source, /const STALE_JOB_MS=10\*60\*1000/);
assert.match(source, /function expireStaleJobs\(\):Promise<number>/);
assert.match(source, /stale_running_timeout/);
assert.match(source, /route==="\/health"\|\|route==="\/api\/get-price"\|\|route==="\/api\/result"/);


// Brand canonicalization is a hard persistence gate.
assert.match(source,/function canonicalBrandFallback\(value:unknown\):string/);
assert.match(source,/function resolveCanonicalProductBrands\(products:Product\[\]\):Promise<void>/);
assert.match(source,/from\("getlink_brand_aliases"\)/);
assert.match(source,/await resolveCanonicalProductBrands\(brandProducts\);[\s\S]*?const categoryId=await idFor\(input\)/);
assert.match(brandMigration,/create table if not exists public\.getlink_brand_aliases/i);
assert.match(brandMigration,/getlink_brand_key/i);
assert.match(brandMigration,/update public\.getlink_links/i);
assert.match(brandMigration,/update public\.getlink_source_product_identity/i);


// Source manager preserves raw source labels and exposes one lazy summary endpoint.
assert.match(source,/raw_brand:clean\(si\.raw_brand\|\|si\.brand\|\|p\.branch\)/);
assert.match(source,/raw_category:clean\(si\.raw_category\|\|si\.category\|\|p\.group\)/);
assert.match(source,/function sourceManagerSnapshot\(force=false\)/);
assert.match(source,/view==="source-manager"/);
assert.match(source,/sourceManagerCache=null/);
assert.match(sourceManagerMigration,/add column if not exists raw_brand text/i);
assert.match(sourceManagerMigration,/add column if not exists raw_category text/i);
assert.match(sourceManagerMigration,/getlink_price_snapshots/i);


// RAW source capture is append-only and happens before any normalizer runs.
assert.match(source,/type RawCaptureEntry=/);
assert.match(source,/function readCapturedJson\(/);
assert.match(source,/function persistRawCapture\(/);
assert.match(source,/capture_stage:"source_original"/);
assert.match(source,/await persistRawCapture\(requestId,url,"category",key,capture\);[\s\S]*?normalizeWinmart/);
assert.match(source,/await persistRawCapture\(requestId,url,"product",key,capture\);[\s\S]*?normalizeBhxDetail/);
assert.match(source,/await persistRawCapture\(requestId,url,"category",key,capture\);[\s\S]*?normalizeGo/);
assert.match(rawMigration,/create table if not exists public\.getlink_raw_fetches/i);
assert.match(rawMigration,/capture_stage in \('source_original','legacy_processed'\)/i);
assert.match(rawMigration,/before update or delete on public\.getlink_raw_fetches/i);
assert.match(rawMigration,/raise exception 'getlink_raw_fetches is append-only'/i);
assert.match(rawMigration,/'legacy_processed'/i);
assert.match(rawMigration,/legacy:getlink_jobs\.result_json/i);


// User-owned manual groups are separate from source/raw groups and auto-refresh on persistence.
assert.match(source,/function manualGroupMatches\(name:unknown,rule:any\):boolean/);
assert.match(source,/function syncManualGroupsForProductRows\(rows:any\[\]\):Promise<void>/);
assert.match(source,/await syncManualGroupsForProductRows\(rows\);/);
assert.match(source,/fetchAll\("getlink_manual_groups"/);
assert.match(source,/manual_groups:\[\.\.\.manualMap\.values\(\)\]/);
assert.match(manualGroupMigration,/create table if not exists public\.getlink_manual_groups/i);
assert.match(manualGroupMigration,/create table if not exists public\.getlink_manual_group_members/i);
assert.match(manualGroupMigration,/'dau-an','Dầu ăn','name_contains','dầu ăn'/);
assert.match(manualGroupMigration,/lower\(coalesce\(l\.name,''\)\) like '%dầu ăn%'/);


// Manual group detail must expose the actual products for auditing, not only totals.
assert.match(source,/function sourceManagerManualGroupDetail\(groupKey:string\)/);
assert.match(source,/function fetchRowsByValues\(/);
assert.match(source,/view==="manual-group"/);
assert.match(source,/raw_group:clean\(id\.raw_category\|\|id\.category\)/);
assert.match(source,/brand:clean\(id\.brand\|\|link\.branch_name\)/);


// Manual groups support multiple OR conditions without touching source/raw fields.
assert.match(source,/getlink_manual_group_rules/);
assert.match(source,/name_product_phrase/);
assert.match(source,/hay\.startsWith\(value\)\|\|\(hay\.startsWith\("thùng "\)&&hay\.includes\(value\)\)/);
assert.match(source,/const members:any\[\]=\[\]/);
assert.match(source,/assignedUrls\.has\(linkUrl\)/);
assert.match(manualRulesMigration,/create table if not exists public\.getlink_manual_group_rules/i);
assert.match(manualRulesMigration,/'dầu cooking'/i);
assert.match(manualRulesMigration,/'dầu đậu nành'/i);
assert.match(manualRulesMigration,/'dầu hướng dương'/i);
assert.match(manualRulesMigration,/'dầu thực vật'/i);
assert.match(manualRulesMigration,/with rules as/i);


// Manual group Mì chính is derived from product names, not source group names.
assert.match(miChinhMigration,/'mi-chinh','Mì chính'/);
assert.match(miChinhMigration,/'mì chính'/i);
assert.match(miChinhMigration,/'bột ngọt'/i);
assert.match(miChinhMigration,/getlink_manual_group_rules/i);
assert.match(miChinhMigration,/getlink_manual_group_members/i);


// Manual classification is exclusive/sticky and new groups skip already-classified products.
assert.match(source,/once a product has been classified, later groups must skip it/);
assert.match(source,/const assignedUrls=new Set/);
assert.match(source,/if\(!linkUrl\|\|assignedUrls\.has\(linkUrl\)\)continue/);
assert.match(source,/assignedUrls\.add\(linkUrl\);\s*break;/);
assert.match(source,/normalize\("NFC"\)/);
assert.match(exclusiveCoffeeMigration,/create unique index if not exists ux_getlink_manual_group_members_link_url/i);
assert.match(exclusiveCoffeeMigration,/'ca-phe','Cà phê'/);
assert.match(exclusiveCoffeeMigration,/'cafe'/i);
assert.match(exclusiveCoffeeMigration,/'café'/i);
assert.match(exclusiveCoffeeMigration,/'caffe'/i);
assert.match(exclusiveCoffeeMigration,/not exists\s*\(\s*select 1\s*from public\.getlink_manual_group_members existing/i);
assert.match(exclusiveCoffeeMigration,/normalize\(lower\(l\.name\),NFC\)/i);


// Broad Bánh group is created after earlier classifications and skips assigned products.
assert.match(banhMigration,/'banh','Bánh'/);
assert.match(banhMigration,/'name_product_phrase','bánh'/);
assert.match(banhMigration,/normalize\(lower\(l\.name\),NFC\) like 'bánh%'/i);
assert.match(banhMigration,/normalize\(lower\(l\.name\),NFC\) like 'thùng %'/i);
assert.match(banhMigration,/not exists\s*\(\s*select 1\s*from public\.getlink_manual_group_members existing/i);


// Sữa chua uses structured product-name matching and still skips assigned products.
assert.match(source,/name_product_pack_phrase/);
assert.match(source,/name_pack_contains/);
assert.match(source,/\\s\+\\d\+/);
assert.match(suaChuaMigration,/'sua-chua','Sữa chua'/);
assert.match(suaChuaMigration,/'sữa chua'/i);
assert.match(suaChuaMigration,/'yogurt'/i);
assert.match(suaChuaMigration,/'yoghurt'/i);
assert.match(suaChuaMigration,/'yaourt'/i);
assert.match(suaChuaMigration,/'th true yogurt'/i);
assert.match(suaChuaMigration,/not exists\s*\(\s*select 1\s*from public\.getlink_manual_group_members existing/i);


// Manual-group detail chunks URL filters to avoid oversized PostgREST .in(...) requests.
assert.match(source,/for\(let i=0;i<unique\.length;i\+=40\)/);
assert.match(source,/unique\.slice\(i,i\+40\)/);

console.log("GETLINK name filter contract: OK");
