import fs from "node:fs";
import assert from "node:assert/strict";

const source = fs.readFileSync("supabase/functions/getlink-api/index.ts", "utf8");
const brandMigration = fs.readFileSync("supabase/migrations/20260908163000_brand_canonical_registry.sql","utf8");
const sourceManagerMigration = fs.readFileSync("supabase/migrations/20260908164000_source_manager_raw_fields.sql","utf8");
const rawMigration = fs.readFileSync("supabase/migrations/20260908165000_immutable_raw_fetches.sql","utf8");

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

console.log("GETLINK name filter contract: OK");
