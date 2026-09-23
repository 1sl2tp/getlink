import fs from "node:fs";
import assert from "node:assert/strict";

const relay = fs.readFileSync("relay/src/index.js", "utf8");

assert.match(relay, /\/youtube\/resolve/, "relay must expose a YouTube resolver route");
assert.match(relay, /\/youtube\/media/, "relay must expose a YouTube media proxy route");
assert.match(relay, /WEB_EMBEDDED_PLAYER|ANDROID_VR|TVHTML5/, "resolver must use a YouTube InnerTube client");
assert.match(relay, /7\.20260707\.07\.00/, "resolver must try the current TVHTML5 client");
assert.match(relay, /5\.20260707/, "resolver must keep a downgraded TVHTML5 fallback");
assert.match(relay, /videoId/, "resolver must send the requested video id to InnerTube");
assert.match(relay, /Range|range/i, "media proxy must preserve byte-range playback");
assert.match(relay, /googlevideo\.com|videoplayback/, "media proxy must only relay Google video media");
assert.doesNotMatch(relay, /url\.searchParams\.get\(["']url["']\)/, "relay must not become an arbitrary open proxy");

console.log("YouTube Cloudflare relay contract: OK");
