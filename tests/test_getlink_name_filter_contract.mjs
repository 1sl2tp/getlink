import fs from "node:fs";
import assert from "node:assert/strict";

const source = fs.readFileSync("supabase/functions/getlink-api/index.ts", "utf8");

assert.match(source, /function keepGetlinkProduct\(p: Product\)/);
assert.match(source, /comboHay/);
assert.match(source, /product_blocked_by_name_rule/);
assert.match(source, /filterGetlinkProducts\(raw\.items\.map\(\(x:any\)=>normalizeWinmart/);
assert.match(source, /filterGetlinkProducts\(raw\.items\.map\(\(x:any\)=>normalizeBhx/);
assert.match(source, /filterGetlinkProducts\(raw\.items\.map\(\(x:any\)=>normalizeGo/);

// Lock the intended exception: numeric+text is only allowed when the same
// numeric-leading prefix is the source brand, e.g. 3 Miền / 7 Up.
assert.match(source, /isNumericBrandException\(name,brand\)/);
assert.match(source, /n===b\|\|n\.startsWith\(b\+" "\)/);

console.log("GETLINK name filter contract: OK");
