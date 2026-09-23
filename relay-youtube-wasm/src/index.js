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


const DIRECT_CLIENTS = [
  {
    name: "IOS",
    version: "21.03.2",
    ua: "com.google.ios.youtube/21.03.2(iPhone16,2; U; CPU iOS 18_7_2 like Mac OS X; VN)",
    visitorHost: "https://www.youtube.com",
    playerHost: "https://youtubei.googleapis.com",
    client: {
      clientName: "IOS",
      clientVersion: "21.03.2",
      clientScreen: "WATCH",
      platform: "MOBILE",
      deviceMake: "Apple",
      deviceModel: "iPhone16,2",
      osName: "iOS",
      osVersion: "18.7.2.22H124",
      hl: "vi",
      gl: "VN",
      utcOffsetMinutes: 0
    }
  },
  {
    name: "VISIONOS",
    version: "1.02",
    ua: "com.google.visionos.youtube/1.02(RealityDevice14,1; U; CPU visionOS 25_6_0 like Mac OS X; VN)",
    visitorHost: "https://www.youtube.com",
    playerHost: "https://youtubei.googleapis.com",
    client: {
      clientName: "VISIONOS",
      clientVersion: "1.02",
      clientScreen: "WATCH",
      platform: "MOBILE",
      deviceMake: "Apple",
      deviceModel: "RealityDevice14,1",
      osName: "visionOS",
      osVersion: "25.6.0.23O471",
      hl: "vi",
      gl: "VN",
      utcOffsetMinutes: 0
    }
  },
  {
    name: "WEB",
    version: "2.20260120.01.00",
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
    visitorHost: "https://www.youtube.com",
    playerHost: "https://www.youtube.com",
    client: {
      clientName: "WEB",
      clientVersion: "2.20260120.01.00",
      clientScreen: "WATCH",
      platform: "DESKTOP",
      hl: "vi",
      gl: "VN",
      utcOffsetMinutes: 0
    }
  }
];

function randomToken(length) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (const b of bytes) out += chars[b % chars.length];
  return out;
}

function baseContext(client) {
  return {
    context: {
      client: { ...client.client },
      request: { internalExperimentFlags: [], useSsl: true },
      user: { lockedSafetyMode: false }
    }
  };
}

function mobileHeaders(client) {
  return {
    "accept": "*/*",
    "content-type": "application/json",
    "user-agent": client.ua,
    "x-goog-api-format-version": "2"
  };
}

async function directVisitorData(client) {
  const url = client.visitorHost + "/youtubei/v1/visitor_id?prettyPrint=false";
  const response = await fetch(url, {
    method: "POST",
    headers: mobileHeaders(client),
    body: JSON.stringify(baseContext(client)),
    redirect: "follow"
  });
  const text = await response.text();
  if (!response.ok) throw new Error(client.name + "_visitor_http_" + response.status + ":" + text.slice(0, 160));
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(client.name + "_visitor_not_json:" + text.slice(0, 160)); }
  const visitor = String(data?.responseContext?.visitorData || "");
  if (!visitor) throw new Error(client.name + "_visitor_missing");
  return visitor;
}

async function directPlayer(client, videoId) {
  const visitorData = await directVisitorData(client);
  const body = baseContext(client);
  body.context.client.visitorData = visitorData;
  body.videoId = videoId;
  body.cpn = randomToken(16);
  body.contentCheckOk = true;
  body.racyCheckOk = true;

  const t = randomToken(12);
  const url = client.playerHost + "/youtubei/v1/player?prettyPrint=false&t=" + encodeURIComponent(t) + "&id=" + encodeURIComponent(videoId);
  const headers = mobileHeaders(client);
  if (client.name === "WEB") {
    headers["x-youtube-client-name"] = "1";
    headers["x-youtube-client-version"] = client.version;
    headers["origin"] = "https://www.youtube.com";
    headers["referer"] = "https://www.youtube.com";
    headers["cookie"] = "SOCS=CAE=";
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    redirect: "follow"
  });
  const text = await response.text();
  if (!response.ok) throw new Error(client.name + "_player_http_" + response.status + ":" + text.slice(0, 200));
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(client.name + "_player_not_json:" + text.slice(0, 180)); }
  return { data, request: { url, headers, body: JSON.stringify(body) } };
}

function directFormats(player) {
  return [
    ...(Array.isArray(player?.streamingData?.formats) ? player.streamingData.formats : []),
    ...(Array.isArray(player?.streamingData?.adaptiveFormats) ? player.streamingData.adaptiveFormats : [])
  ].filter((x) => typeof x?.url === "string" && x.url);
}


function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseMime(mimeType) {
  const raw = String(mimeType || "");
  const [mimePart, ...rest] = raw.split(";");
  const match = raw.match(/codecs="([^"]+)"/i);
  return {
    mime: mimePart.trim() || "application/octet-stream",
    codecs: match ? match[1] : ""
  };
}

function chooseDirectVideo(formats, maxHeight = 480) {
  const candidates = formats.filter((x) => {
    const mime = String(x?.mimeType || "");
    const hasVideo = Boolean(x?.width || x?.height || x?.qualityLabel);
    const hasAudio = Boolean(x?.audioQuality || x?.audioChannels);
    return mime.includes("video/mp4") && hasVideo && !hasAudio
      && x?.initRange?.start != null && x?.initRange?.end != null
      && x?.indexRange?.start != null && x?.indexRange?.end != null;
  });
  if (!candidates.length) return null;
  const bounded = candidates.filter((x) => Number(x?.height || 0) <= maxHeight);
  const pool = bounded.length ? bounded : candidates;
  return pool.sort((a, b) => {
    const ah = Number(a?.height || 0);
    const bh = Number(b?.height || 0);
    if (ah !== bh) return bh - ah;
    return Number(b?.bitrate || 0) - Number(a?.bitrate || 0);
  })[0] || null;
}

function chooseDirectAudio(formats) {
  const candidates = formats.filter((x) => {
    const mime = String(x?.mimeType || "");
    const hasVideo = Boolean(x?.width || x?.height || x?.qualityLabel);
    const hasAudio = Boolean(x?.audioQuality || x?.audioChannels);
    return mime.includes("audio/mp4") && hasAudio && !hasVideo
      && x?.initRange?.start != null && x?.initRange?.end != null
      && x?.indexRange?.start != null && x?.indexRange?.end != null;
  });
  if (!candidates.length) return null;
  return candidates.sort((a, b) => {
    const abr = Number(a?.bitrate || 0);
    const bbr = Number(b?.bitrate || 0);
    const target = 160000;
    return Math.abs(abr - target) - Math.abs(bbr - target);
  })[0] || null;
}

function directMediaUrl(origin, requestInfo, itag) {
  return mediaRelayUrl(
    origin,
    requestInfo.url,
    requestInfo.body,
    requestInfo.headers,
    itag
  );
}

function segmentBaseXml(format) {
  const initStart = String(format?.initRange?.start ?? "0");
  const initEnd = String(format?.initRange?.end ?? "0");
  const indexStart = String(format?.indexRange?.start ?? "0");
  const indexEnd = String(format?.indexRange?.end ?? "0");
  return '<SegmentBase indexRange="' + xmlEscape(indexStart + "-" + indexEnd) + '">'
    + '<Initialization range="' + xmlEscape(initStart + "-" + initEnd) + '"/>'
    + '</SegmentBase>';
}

async function handleDirectManifest(request) {
  const u = new URL(request.url);
  const id = String(u.searchParams.get("id") || "");
  const requestedHeight = Math.max(240, Math.min(720, Number(u.searchParams.get("h") || 480)));
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) {
    return new Response("invalid_video", { status: 400, headers: corsHeaders() });
  }

  const client = DIRECT_CLIENTS.find((x) => x.name === "IOS");
  try {
    const resolved = await directPlayer(client, id);
    const player = resolved.data;
    const formats = directFormats(player);
    const video = chooseDirectVideo(formats, requestedHeight);
    const audio = chooseDirectAudio(formats);
    if (!video || !audio) {
      return json({
        ok: false,
        error: "adaptive_formats_missing",
        available: formats.map((x) => ({
          itag: x?.itag,
          mimeType: x?.mimeType,
          height: x?.height,
          audioQuality: x?.audioQuality,
          hasInit: Boolean(x?.initRange),
          hasIndex: Boolean(x?.indexRange)
        })).slice(0, 40)
      }, 502);
    }

    const origin = u.origin;
    const duration = Math.max(
      1,
      Number(player?.videoDetails?.lengthSeconds || 0)
        || Number(video?.approxDurationMs || audio?.approxDurationMs || 0) / 1000
        || 1
    );
    const videoMime = parseMime(video.mimeType);
    const audioMime = parseMime(audio.mimeType);
    const videoUrl = directMediaUrl(origin, resolved.request, video.itag);
    const audioUrl = directMediaUrl(origin, resolved.request, audio.itag);

    const mpd = '<?xml version="1.0" encoding="UTF-8"?>'
      + '<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" '
      + 'profiles="urn:mpeg:dash:profile:isoff-on-demand:2011" '
      + 'mediaPresentationDuration="PT' + duration.toFixed(3) + 'S" minBufferTime="PT1.5S">'
      + '<Period start="PT0S">'
      + '<AdaptationSet id="1" contentType="video" mimeType="' + xmlEscape(videoMime.mime) + '" '
      + 'segmentAlignment="true" startWithSAP="1">'
      + '<Representation id="v' + xmlEscape(video.itag) + '" bandwidth="' + Math.max(1, Number(video.bitrate || 1)) + '" '
      + 'width="' + Math.max(1, Number(video.width || 1)) + '" height="' + Math.max(1, Number(video.height || 1)) + '" '
      + 'frameRate="' + xmlEscape(video.fps || 30) + '" codecs="' + xmlEscape(videoMime.codecs) + '">'
      + '<BaseURL>' + xmlEscape(videoUrl) + '</BaseURL>'
      + segmentBaseXml(video)
      + '</Representation></AdaptationSet>'
      + '<AdaptationSet id="2" contentType="audio" mimeType="' + xmlEscape(audioMime.mime) + '" '
      + 'segmentAlignment="true" startWithSAP="1">'
      + '<Representation id="a' + xmlEscape(audio.itag) + '" bandwidth="' + Math.max(1, Number(audio.bitrate || 1)) + '" '
      + 'audioSamplingRate="' + xmlEscape(audio.audioSampleRate || 44100) + '" codecs="' + xmlEscape(audioMime.codecs) + '">'
      + '<AudioChannelConfiguration schemeIdUri="urn:mpeg:dash:23003:3:audio_channel_configuration:2011" '
      + 'value="' + Math.max(1, Number(audio.audioChannels || 2)) + '"/>'
      + '<BaseURL>' + xmlEscape(audioUrl) + '</BaseURL>'
      + segmentBaseXml(audio)
      + '</Representation></AdaptationSet>'
      + '</Period></MPD>';

    return new Response(mpd, {
      status: 200,
      headers: {
        ...corsHeaders(),
        "content-type": "application/dash+xml; charset=utf-8",
        "cache-control": "no-store",
        "x-1988-client": "IOS",
        "x-1988-video-itag": String(video.itag),
        "x-1988-audio-itag": String(audio.itag),
        "x-1988-duration": String(duration)
      }
    });
  } catch (error) {
    return json({
      ok: false,
      error: "direct_manifest_failed",
      detail: String(error?.message || error).slice(0, 900)
    }, 502);
  }
}

async function handleDirectProbe(request) {
  const u = new URL(request.url);
  const id = String(u.searchParams.get("id") || "");
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return json({ ok: false, error: "invalid_video" }, 400);

  const results = [];
  for (const client of DIRECT_CLIENTS) {
    try {
      const { data } = await directPlayer(client, id);
      const formats = directFormats(data);
      const progressive = formats.filter((x) => {
        const mime = String(x?.mimeType || "");
        const audio = Boolean(x?.audioQuality || x?.audioChannels);
        const video = Boolean(x?.qualityLabel || x?.width || x?.height);
        return mime.includes("video/mp4") && audio && video;
      });
      results.push({
        client: client.name,
        status: String(data?.playabilityStatus?.status || ""),
        reason: String(data?.playabilityStatus?.reason || ""),
        formats: formats.length,
        progressive: progressive.map((x) => ({ itag: x.itag, quality: x.qualityLabel, bitrate: x.bitrate })).slice(0, 5)
      });
    } catch (error) {
      results.push({ client: client.name, error: String(error?.message || error).slice(0, 500) });
    }
  }
  return json({ ok: results.some((x) => x.formats > 0), results });
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

    if (incoming.pathname === "/probe-direct") {
      return handleDirectProbe(request);
    }

    if (incoming.pathname === "/direct/manifest") {
      return handleDirectManifest(request);
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
    let bodyText = "";
    if (request.method !== "GET" && request.method !== "HEAD") {
      body = await request.arrayBuffer();
      bodyText = new TextDecoder().decode(body.slice(0));
    }

    let upstream;
    try {
      const youtubeJson = target.pathname.startsWith("/youtubei/");
      const attempts = youtubeJson ? 3 : 1;

      for (let attempt = 0; attempt < attempts; attempt++) {
        upstream = await fetch(target.toString(), {
          method: request.method,
          headers,
          body,
          redirect: "follow"
        });

        if (!youtubeJson) break;

        const contentType = String(upstream.headers.get("content-type") || "").toLowerCase();
        if (upstream.ok && contentType.includes("application/json")) break;

        if (attempt < attempts - 1) {
          try { await upstream.body?.cancel(); } catch {}
          upstream = undefined;
        }
      }

      if (!upstream) throw new Error("no_upstream_response");
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
        const rewritten = rewritePlayerStreams(
          player,
          incoming.origin,
          target.toString(),
          bodyText,
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
