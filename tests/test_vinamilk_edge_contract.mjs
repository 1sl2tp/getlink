import fs from "node:fs";
import assert from "node:assert/strict";

const edge = fs.readFileSync("supabase/functions/getlink-api/index.ts", "utf8");

assert.match(edge, /host === "vinamilk\.com\.vn"/, "Vinamilk domain must be recognized");
assert.match(edge, /function vinamilkNextStrings\(/, "Vinamilk must parse server-rendered Next.js data");
assert.match(edge, /self\\\.__next_f\\\.push/, "Vinamilk parser must read Next.js RSC chunks");
assert.match(edge, /function vinamilkBalancedArray\(/, "Vinamilk variants arrays must be parsed safely");
assert.match(edge, /'"variants":\['/, "Vinamilk parser must locate variants payloads");
assert.match(edge, /Promise\.all\(pages\.map\(p=>vinamilkFetchPage/, "Vinamilk later pages should fetch in bounded parallel batches");
assert.match(edge, /source_product_id:variantId/, "Vinamilk identity must use variant id");
assert.match(edge, /sku:clean\(item\.skuCode/, "Vinamilk identity must preserve SKU");
assert.match(edge, /Math\.round\(currentRaw\)/, "Vinamilk VND price must normalize source float to integer");
assert.match(edge, /item\.image\?\.url/, "Vinamilk image must come from source payload");
assert.ok(edge.includes('BHX_TRANSPORT_URL+"/vinamilk"'), "Vinamilk must use the stateless transport relay");
assert.match(edge, /headers:bhxRelayHeaders\(\)/, "Vinamilk relay must use the shared relay auth gate");
assert.match(edge, /engine:"supabase-edge-vinamilk-relay-rsc"/, "Vinamilk must use relayed server-rendered transport");
assert.doesNotMatch(edge, /VNM_SIGNATURE_SALT|generateApiSignature|x-signature/i, "Vinamilk source must not depend on browser GraphQL signing");

console.log("Vinamilk server-rendered source contract: OK");
