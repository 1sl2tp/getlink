const ALLOWED_HOSTS = new Set([
  "www.youtube.com",
  "youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtubei.googleapis.com",
  "www.google.com"
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

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const incoming = new URL(request.url);
    if (incoming.pathname === "/health") {
      return json({ ok: true, mode: "newpipe-wasm-cors-relay", storage: "none" });
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

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: out
    });
  }
};
