const ALLOWED_HOSTS = new Set([
  "www.youtube.com",
  "youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtubei.googleapis.com",
  "www.google.com",
  "googlevideo.com"
]);

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,HEAD,POST,OPTIONS",
    "access-control-allow-headers": "*",
    "access-control-expose-headers": "content-length,content-range,accept-ranges,content-type,location"
  };
}

function allowedHost(hostname) {
  if (ALLOWED_HOSTS.has(hostname)) return true;
  for (const host of ALLOWED_HOSTS) {
    if (hostname.endsWith("." + host)) return true;
  }
  return false;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(), "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

function b64urlEncode(text) {
  const bytes = new TextEncoder().encode(String(text || ""));
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlDecode(text) {
  let value = String(text || "").replace(/-/g, "+").replace(/_/g, "/");
  while (value.length % 4) value += "=";
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function mediaRelayUrl(origin, targetUrl, requestBody, replayHeaders, itag) {
  const u = new URL("/media", origin);
  u.searchParams.set("t", b64urlEncode(targetUrl));
  u.searchParams.set("b", b64urlEncode(requestBody));
  u.searchParams.set("h", b64urlEncode(JSON.stringify(replayHeaders)));
  u.searchParams.set("i", String(itag || ""));
  return u.toString();
}

function rewritePlayerStreams(player, origin, targetUrl, requestBody, replayHeaders) {
  const groups = [
    player?.streamingData?.formats,
    player?.streamingData?.adaptiveFormats
  ];
  let count = 0;
  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    for (const format of group) {
      if (!format || typeof format !== "object" || !format.url || !format.itag) continue;
      format.url = mediaRelayUrl(origin, targetUrl, requestBody, replayHeaders, format.itag);
      count++;
    }
  }
  return count;
}

async function handleMediaRelay(request) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json({ error: "method_not_allowed" }, 405);
  }

  const u = new URL(request.url);
  let targetUrl, requestBody, replayHeaders, itag;
  try {
    targetUrl = b64urlDecode(u.searchParams.get("t") || "");
    requestBody = b64urlDecode(u.searchParams.get("b") || "");
    replayHeaders = JSON.parse(b64urlDecode(u.searchParams.get("h") || "") || "{}");
    itag = Number(u.searchParams.get("i") || 0);
  } catch {
    return json({ error: "invalid_media_token" }, 400);
  }

  let target;
  try {
    target = new URL(targetUrl);
  } catch {
    return json({ error: "invalid_player_target" }, 400);
  }
  if (
    target.protocol !== "https:" ||
    !allowedHost(target.hostname.toLowerCase()) ||
    !target.pathname.includes("/youtubei/v1/player") ||
    !itag
  ) {
    return json({ error: "invalid_media_target" }, 400);
  }

  const playerHeaders = new Headers();
  for (const [name, value] of Object.entries(replayHeaders || {})) {
    if (typeof value === "string" && value) playerHeaders.set(name, value);
  }
  if (!playerHeaders.has("content-type")) playerHeaders.set("content-type", "application/json");

  let playerResponse;
  try {
    playerResponse = await fetch(target.toString(), {
      method: "POST",
      headers: playerHeaders,
      body: requestBody,
      redirect: "follow"
    });
  } catch (error) {
    return json({ error: "player_refresh_failed", detail: String(error).slice(0, 300) }, 502);
  }

  if (!playerResponse.ok) {
    const detail = (await playerResponse.text()).slice(0, 500);
    return json({ error: "player_refresh_http", status: playerResponse.status, detail }, 502);
  }

  let player;
  try {
    player = await playerResponse.json();
  } catch {
    return json({ error: "player_refresh_invalid_json" }, 502);
  }

  const formats = [
    ...(Array.isArray(player?.streamingData?.formats) ? player.streamingData.formats : []),
    ...(Array.isArray(player?.streamingData?.adaptiveFormats) ? player.streamingData.adaptiveFormats : [])
  ];
  const format = formats.find((x) => Number(x?.itag) === itag && typeof x?.url === "string");
  if (!format?.url) {
    return json({ error: "itag_not_found", itag }, 502);
  }

  let mediaTarget;
  try {
    mediaTarget = new URL(format.url);
  } catch {
    return json({ error: "invalid_media_url" }, 502);
  }
  const mh = mediaTarget.hostname.toLowerCase();
  if (!(mh === "googlevideo.com" || mh.endsWith(".googlevideo.com"))) {
    return json({ error: "unexpected_media_host", host: mh }, 502);
  }

  const mediaHeaders = new Headers();
  const range = request.headers.get("range");
  if (range) mediaHeaders.set("range", range);
  const ua = playerHeaders.get("user-agent");
  if (ua) mediaHeaders.set("user-agent", ua);
  mediaHeaders.set("accept", "*/*");

  let upstream;
  try {
    upstream = await fetch(mediaTarget.toString(), {
      method: request.method === "HEAD" ? "HEAD" : "GET",
      headers: mediaHeaders,
      redirect: "follow"
    });
  } catch (error) {
    return json({ error: "media_fetch_failed", detail: String(error).slice(0, 300) }, 502);
  }

  const out = new Headers(upstream.headers);
  for (const [k, v] of Object.entries(corsHeaders())) out.set(k, v);
  out.set("cache-control", "no-store");

  if (request.method === "HEAD") {
    try { await upstream.body?.cancel(); } catch {}
    return new Response(null, { status: upstream.status, headers: out });
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const incoming = new URL(request.url);
    if (incoming.pathname === "/health") {
      return json({ ok: true, mode: "newpipe-wasm-cors-relay", storage: "none" });
    }

    if (incoming.pathname === "/media") {
      return handleMediaRelay(request);
    }

    if (incoming.pathname !== "/") {
      return json({ error: "not_found" }, 404);
    }

    const raw = incoming.searchParams.get("url") || "";
    let target;
    try {
      target = new URL(raw);
    } catch {
      return json({ error: "invalid_url" }, 400);
    }

    if (target.protocol !== "https:" || !allowedHost(target.hostname.toLowerCase())) {
      return json({ error: "host_not_allowed", host: target.hostname }, 403);
    }

    const headers = new Headers();
    for (const name of ["accept", "accept-language", "content-type", "range", "user-agent"]) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    const ua = headers.get("user-agent") || "";
    if (!/Mozilla\//i.test(ua)) {
      headers.set("user-agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36");
    }

    let body;
    if (request.method !== "GET" && request.method !== "HEAD") {
      body = await request.arrayBuffer();
    }

    let upstream;
    try {
      upstream = await fetch(target.toString(), {
        method: request.method,
        headers,
        body,
        redirect: "follow"
      });
    } catch (error) {
      return json({ error: "upstream_fetch_failed", detail: String(error).slice(0, 300) }, 502);
    }

    const out = new Headers(upstream.headers);
    for (const [k, v] of Object.entries(corsHeaders())) out.set(k, v);
    out.set("cache-control", "no-store");

    const isPlayer = target.pathname.includes("/youtubei/v1/player");
    if (isPlayer && upstream.ok) {
      try {
        const text = await upstream.text();
        const player = JSON.parse(text);
        const replayHeaders = Object.fromEntries(headers.entries());
        const requestBody = body ? new TextDecoder().decode(body) : "";
        const rewritten = rewritePlayerStreams(
          player,
          incoming.origin,
          target.toString(),
          requestBody,
          replayHeaders
        );
        if (rewritten > 0) {
          out.set("content-type", "application/json; charset=utf-8");
          out.delete("content-length");
          out.delete("content-encoding");
          return new Response(JSON.stringify(player), {
            status: upstream.status,
            statusText: upstream.statusText,
            headers: out
          });
        }
        return new Response(text, {
          status: upstream.status,
          statusText: upstream.statusText,
          headers: out
        });
      } catch {}
    }

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: out
    });
  }
};
