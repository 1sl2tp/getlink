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

console.log("GETLINK name filter contract: OK");
