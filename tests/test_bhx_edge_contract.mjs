import fs from "node:fs";
import assert from "node:assert/strict";

const source = fs.readFileSync("supabase/functions/getlink-api/index.ts", "utf8");

assert.equal(
  (source.match(/const BHX_HTTP1_CLIENT/g) || []).length,
  1,
  "BHX HTTP client must only be declared once"
);
assert.match(source, /pageSize:String\(BHX_PAGE_SIZE\)/, "GetCate must use the BHX page size constant");
assert.match(source, /PriorityProductIds:priorityProductIds/, "AjaxProduct must reuse GetCate priorityProductIds");
assert.match(source, /LastShowProductId:lastShowProductId/, "AjaxProduct must carry LastShowProductId continuation");
assert.match(source, /for\(let page=2;page<=maxPage;page\+\+\)/, "AjaxProduct must start after GetCate page 1");
assert.doesNotMatch(source, /GetCateVegetable/, "legacy vegetable fallback must not be mixed into normal BHX pagination");
assert.doesNotMatch(source, /F7029C832B7798D1754A64B8F927D09B/, "captured browser bearer token must never be committed");

console.log("BHX edge continuation contract: OK");
