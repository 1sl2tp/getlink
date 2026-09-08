import fs from "node:fs";
import assert from "node:assert/strict";

const edge = fs.readFileSync("supabase/functions/getlink-api/index.ts", "utf8");

assert.match(edge, /function goRuntimeConfig\(/, "GO must load runtime auth outside source code");
assert.match(edge, /getlink_go_runtime_config/, "GO must support Vault-backed runtime config");
assert.match(edge, /GO_API_CLIENT_ID/, "GO may use Edge secret override");
assert.match(edge, /GO_API_SIGN/, "GO may use Edge secret override");
assert.match(edge, /GO_API_TOKEN/, "GO may use Edge secret override");
assert.match(edge, /GO_STORE_ID/, "GO may use Edge secret override");

assert.match(edge, /order2_listProduct\?platform=2&lang=vi/, "GO must use its native product API");
assert.match(edge, /"apiclientid":cfg\.apiclientid/, "GO must send API client id");
assert.match(edge, /"sign":cfg\.sign/, "GO must send API sign");
assert.match(edge, /"token":cfg\.token/, "GO must send API token");
assert.match(edge, /"storeid":String\(store\)/, "GO must send selected store id header");
assert.match(edge, /"origin":"https:\/\/sieuthi-go\.vn"/, "GO must send same-origin header");
assert.match(edge, /"referer":c/, "GO must send category referer");
assert.doesNotMatch(edge, /device_token|x-csrf-token|x-signature|_ga=/i, "browser cookies/session noise must not be committed");

assert.match(edge, /start\+=10/, "GO pages should use bounded parallel batches");
assert.match(edge, /Promise\.all\(nums\.map\(fetchPage\)\)/, "GO pages should fetch in parallel");
assert.match(edge, /go_auth_refresh_required/, "GO auth expiry must surface explicitly");

console.log("GO direct API contract: OK");
