import fs from "node:fs";
import assert from "node:assert/strict";

const edge = fs.readFileSync("supabase/functions/getlink-api/index.ts", "utf8");

assert.match(edge, /host === "vinamilk\.com\.vn"/, "Vinamilk domain must be recognized");
assert.match(edge, /const VINAMILK_SEARCH_QUERY=/, "Vinamilk must have a direct GraphQL search query");
assert.match(edge, /eshop_searchProducts\(payload: \$payload\)/, "Vinamilk must use searchProducts GraphQL");
assert.match(edge, /collectionHandle/, "Vinamilk collection slug must be sent to GraphQL");
assert.match(edge, /offset/, "Vinamilk search must support offset pagination");
assert.match(edge, /VINAMILK_PAGE_SIZE=24/, "Vinamilk pagination must use a bounded page size");
assert.match(edge, /Promise\.all\([\s\S]*vinamilkSearchPage/, "Vinamilk later pages should fetch in bounded parallel batches");
assert.match(edge, /price \{ price originPrice currency discount \}/, "Vinamilk query must fetch current and original prices");
assert.match(edge, /image \{ url isDefault \}/, "Vinamilk query must fetch source images");
assert.match(edge, /sellableInfo \{ sellable \}/, "Vinamilk query must preserve sellable state");
assert.match(edge, /source_product_id:variantId/, "Vinamilk identity must use variant id");
assert.match(edge, /sku:clean\(item\.skuCode/, "Vinamilk identity must preserve SKU");
assert.match(edge, /Math\.round\(currentRaw\)/, "Vinamilk VND price must normalize source float to integer");
assert.match(edge, /item\.image\?\.url/, "Vinamilk image must come from source payload");
assert.match(edge, /const directUrl=handle[\s\S]*encodeURIComponent\(handle\)/, "Vinamilk direct URL must require a real handle");
assert.match(edge, /open_url:directUrl/, "Vinamilk payload must keep verified direct URL separate");
assert.doesNotMatch(edge, /handle\|\|clean\(p\.productId/, "Vinamilk productId must not be treated as a verified direct handle");
assert.ok(edge.includes('BHX_TRANSPORT_URL+"/vinamilk"'), "Vinamilk must use the stateless signed relay");
assert.match(edge, /headers:bhxRelayHeaders\(\)/, "Vinamilk relay must use the shared relay auth gate");
assert.match(edge, /engine:"supabase-edge-vinamilk-direct-graphql"/, "Vinamilk must use direct GraphQL transport");
assert.doesNotMatch(edge, /function vinamilkNextStrings\(/, "Vinamilk must not parse Next.js HTML");
assert.doesNotMatch(edge, /self\\\.__next_f\\\.push/, "Vinamilk must not depend on RSC chunks");

console.log("Vinamilk direct GraphQL source contract: OK");
