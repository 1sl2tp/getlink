import fs from "node:fs";
import assert from "node:assert/strict";

const source = fs.readFileSync("supabase/functions/getlink-api/index.ts", "utf8");

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

console.log("GETLINK name filter contract: OK");
