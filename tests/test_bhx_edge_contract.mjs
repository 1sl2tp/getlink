import fs from "node:fs";
import assert from "node:assert/strict";

const edge = fs.readFileSync("supabase/functions/getlink-api/index.ts", "utf8");
const proxy = fs.readFileSync("relay/src/index.js", "utf8");

assert.equal(
  (edge.match(/const BHX_HTTP1_CLIENT/g) || []).length,
  1,
  "BHX HTTP client must only be declared once"
);
assert.match(edge, /BHX_TRANSPORT_URL/, "Supabase edge must define the stateless BHX relay");
assert.match(edge, /BHX_TRANSPORT_URL\+"\/category"/, "Supabase edge must call the BHX category transport");
assert.match(edge, /bhx_product_not_found_in_category/, "BHX product detail must fall back to category data");
assert.doesNotMatch(edge, /F7029C832B7798D1754A64B8F927D09B/, "captured browser bearer token must never be committed");

assert.match(proxy, /Category\/V2\/GetCate/, "relay must bootstrap from GetCate");
assert.match(proxy, /Category\/AjaxProduct/, "relay must continue with AjaxProduct");
assert.match(proxy, /PageIndex:page/, "relay must advance AjaxProduct page index");
assert.match(proxy, /PriorityProductIds:priority/, "relay must reuse priorityProductIds");
assert.match(proxy, /LastShowProductId:lastShowProductId/, "relay must carry LastShowProductId");
assert.match(proxy, /storage:"none"/, "BHX relay must remain stateless");
assert.doesNotMatch(proxy, /D1|\.prepare\(/, "BHX relay must not use Cloudflare storage");

console.log("BHX stateless transport contract: OK");
