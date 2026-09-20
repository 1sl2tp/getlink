import fs from "node:fs";
import assert from "node:assert/strict";

const edge=fs.readFileSync("supabase/functions/getlink-api/index.ts","utf8");
const app=fs.readFileSync("app.js","utf8");
const css=fs.readFileSync("style.css","utf8");

assert.match(edge,/host === "vinamilk\.com\.vn" \|\| host === "partners\.vinamilk\.com\.vn"/);
assert.match(edge,/host === "concung\.com"/);
assert.match(edge,/function canonicalVinamilk\(/);
assert.match(edge,/function canonicalConcung\(/);
assert.match(edge,/function readCapturedText\(/);
assert.match(edge,/function retailJsonLdProducts\(/);
assert.match(edge,/function retailDomProducts\(/);
assert.match(edge,/function retailHtmlCategory\(/);
assert.match(edge,/function normalizeRetailHtml\(/);
assert.match(edge,/function retailStructuredMoney\(/);
assert.match(edge,/if\(key==="vinamilk"\|\|key==="concung"\)/);
assert.match(edge,/await persistRawCapture\(requestId,url,"category",key,capture\)/);
assert.match(edge,/engine:"supabase-edge-"\+key\+"-html"/);
assert.match(edge,/source_pages:raw\.pages/);
assert.match(edge,/fallback\.hostname="partners\.vinamilk\.com\.vn"/);
assert.match(edge,/path\.match\(\/-\(\\d\{4,\}\)\\\.html\$\/\)/);

assert.match(app,/MOBILE_MARKET_SOURCES=\["bhx","wm","go","vinamilk","concung"\]/);
assert.match(app,/function isVinamilkRow\(/);
assert.match(app,/function isConcungRow\(/);
assert.match(app,/return "vinamilk"/);
assert.match(app,/return "concung"/);
assert.match(app,/TABLE_SOURCE_CYCLE=\["","mine","bhx","wm","go","vinamilk","concung"\]/);
assert.match(app,/vinamilk:\{full:"Vinamilk"/);
assert.match(app,/concung:\{full:"Con Cưng"/);
assert.match(app,/<b>6<\/b>/);
assert.match(app,/host==="vinamilk\.com\.vn"/);
assert.match(app,/host==="partners\.vinamilk\.com\.vn"/);
assert.match(app,/host==="concung\.com"/);
assert.match(app,/sourceManagerVinamilkCount/);
assert.match(app,/sourceManagerConcungCount/);

assert.match(css,/source-vinamilk/);
assert.match(css,/source-concung/);
assert.match(css,/data-source="vinamilk"/);
assert.match(css,/data-source="concung"/);
assert.match(css,/source-logo-vinamilk/);
assert.match(css,/source-logo-concung/);

console.log("Vinamilk + Con Cưng source contract: OK");
