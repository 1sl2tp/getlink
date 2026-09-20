import fs from "node:fs";
import assert from "node:assert/strict";

const relay=fs.readFileSync("relay/src/index.js","utf8");

assert.match(relay,/const VNM_GRAPHQL_PATH = "\/api\/graphql-pub\/"/);
assert.match(relay,/async function vinamilkGraphql\(/);
assert.match(relay,/function vinamilkConfig\(env\)/);
assert.match(relay,/VNM_SIGNATURE_SALT/);
assert.match(relay,/VNM_CLIENT_ID/);
assert.match(relay,/VNM_X_TERMINAL/);
assert.match(relay,/VNM_EXTERNAL_CODE/);
assert.match(relay,/\[VNM_GRAPHQL_PATH, timestamp, deviceInfo, graphqlHash, cfg\.salt\]\.join\("\."\)/);
assert.match(relay,/"x-graphql-hash": graphqlHash/);
assert.match(relay,/"x-signature": signature/);
assert.match(relay,/async function handleVinamilk\(/);
assert.match(relay,/relayAuthorized\(request, env\)/);
assert.match(relay,/url\.pathname === "\/vinamilk"/);
assert.doesNotMatch(relay,/canonicalVinamilkRelayUrl/,"relay must not fetch Vinamilk HTML");
assert.doesNotMatch(relay,/text\/html,application\/xhtml\+xml/,"relay must not use the old HTML transport");

console.log("Vinamilk signed relay contract: OK");
