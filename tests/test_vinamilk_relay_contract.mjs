import fs from "node:fs";
import assert from "node:assert/strict";

const relay=fs.readFileSync("relay/src/index.js","utf8");

assert.match(relay,/function canonicalVinamilkRelayUrl\(/);
assert.match(relay,/host !== "vinamilk\.com\.vn"/);
assert.match(relay,/vinamilk_catalog_url_required/);
assert.match(relay,/async function handleVinamilk\(/);
assert.match(relay,/relayAuthorized\(request, env\)/);
assert.match(relay,/url\.pathname === "\/vinamilk"/);
assert.match(relay,/upstream_status: upstream\.status/);
assert.match(relay,/body\.length > 6_000_000/);
assert.doesNotMatch(relay,/raw\?\.url[^\n]*fetch\(/,"relay must canonicalize before fetch");

console.log("Vinamilk relay contract: OK");
