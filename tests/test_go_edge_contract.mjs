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
assert.match(edge, /"apiclientid":attemptCfg\.apiclientid/, "GO must send API client id");
assert.match(edge, /"sign":attemptCfg\.sign/, "GO must send API sign");
assert.match(edge, /"token":attemptCfg\.token/, "GO must send API token");
assert.match(edge, /"storeid":String\(store\)/, "GO must send selected store id header");
assert.match(edge, /"origin":"https:\/\/sieuthi-go\.vn"/, "GO must send same-origin header");
assert.match(edge, /"referer":c/, "GO must send category referer");
assert.doesNotMatch(edge, /device_token|x-csrf-token|x-signature|_ga=/i, "browser cookies/session noise must not be committed");

assert.match(edge, /start\+=10/, "GO pages should use bounded parallel batches");
assert.match(edge, /Promise\.all\(nums\.map\(fetchPage\)\)/, "GO pages should fetch in parallel");
assert.match(edge, /go_auth_refresh_required/, "GO auth expiry must surface explicitly");
assert.match(edge, /GO_INIT_URL="https:\/\/sieuthi-go\.vn\/api\/init"/, "GO must refresh guest auth from the live init endpoint");
assert.match(edge, /api_version:"1\.0\.0"/, "GO init payload must match the live web client");
assert.match(edge, /name:"go_website"/, "GO init payload must identify the web client");
assert.match(edge, /platform_name:"web"/, "GO init payload must use the web platform");
assert.match(edge, /uid:crypto\.randomUUID\(\)/, "GO refresh must create a guest device uid without browser state");
assert.match(edge, /createHash\("md5"\)\.update\(token\+apiclientid\+GO_AUTH_SALT\)\.digest\("hex"\)/, "GO sign must follow the current site formula");
assert.match(edge, /if\(authExpired&&retryAuth\)/, "GO must refresh expired auth before failing the category");
assert.match(edge, /return fetchPage\(page,false\)/, "GO auth retry must be bounded to one retry");

console.log("GO direct API contract: OK");
