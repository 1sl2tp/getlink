const BHX_HOST = "api.bachhoaxanh.com";
const RELAY_HEADER = "x-getlink-relay";
const RELAY_VALUE = "supabase-bhx-v1";

function relaySecret(env) {
  return clean(env.RELAY_SHARED_SECRET || RELAY_VALUE);
}

function relayAuthorized(request, env) {
  return request.headers.get(RELAY_HEADER) === relaySecret(env);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function clean(v) {
  return String(v ?? "").trim();
}

function boundedInt(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function webReferer(slug, product = "") {
  const path = [clean(slug), clean(product)].filter(Boolean).join("/");
  return "https://www.bachhoaxanh.com/" + path;
}

function bhxHeaders(referer, env) {
  const h = {
    "accept": "application/json, text/plain, */*",
    "accept-language": "vi-VN,vi;q=0.9,en;q=0.7",
    "origin": "https://www.bachhoaxanh.com",
    "referer": referer,
    "referer-url": referer,
    "reversehost": "http://bhxapi.live",
    "xapikey": clean(env.BHX_XAPIKEY || "bhx-api-core-2022"),
    "platform": "webnew",
    "customer-id": "",
    "user-agent": "Mozilla/5.0 (compatible; GETLINK-BHX-Relay/1.0)"
  };
  const token = clean(env.BHX_BEARER_TOKEN || "");
  if (token) h.authorization = /^Bearer\s+/i.test(token) ? token : "Bearer " + token;
  const deviceId = clean(env.BHX_DEVICE_ID || "");
  if (deviceId) h.deviceid = deviceId;
  return h;
}

async function bhxFetch(url, referer, env, body) {
  let last = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, body === undefined ? {
        method: "GET",
        headers: bhxHeaders(referer, env)
      } : {
        method: "POST",
        headers: {
          ...bhxHeaders(referer, env),
          "content-type": "application/json"
        },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        last = "http_" + response.status + ":" + (await response.text()).slice(0, 300);
      } else {
        const data = await response.json();
        if (data && Number(data.code) === 0 && data.data != null) return data;
        last = "code_" + String(data?.code);
      }
    } catch (error) {
      last = String(error?.message || error).slice(0, 300);
    }
  }
  throw new Error("bhx_relay_failed:" + last);
}

function fixedContext() {
  return {
    provinceId: 1027,
    wardId: 0,
    districtId: 0,
    storeId: 2546
  };
}

async function handleBhx(request, env) {
  if (!relayAuthorized(request, env)) {
    return json({ error: "unauthorized" }, 401);
  }

  let raw;
  try { raw = await request.json(); }
  catch { return json({ error: "invalid_json" }, 400); }

  const op = clean(raw?.op);
  const ctx = fixedContext();

  try {
    if (op === "getMenuCategory") {
      const api = new URL("https://" + BHX_HOST + "/gw/Menu/GetMenuV2");
      for (const [k, v] of Object.entries(ctx)) api.searchParams.set(k, String(v));
      const data = await bhxFetch(api.toString(), "https://www.bachhoaxanh.com/", env);
      return json(data);
    }

    if (op === "getCategoryRelative") {
      const categoryId = boundedInt(raw?.categoryId, 1, 99999999, 0);
      if (!categoryId) return json({ error: "invalid_category_id" }, 400);
      const api = new URL("https://" + BHX_HOST + "/gw/Category/GetCategoryRelative");
      for (const [k, v] of Object.entries({ ...ctx, categoryId })) api.searchParams.set(k, String(v));
      const data = await bhxFetch(api.toString(), "https://www.bachhoaxanh.com/", env);
      return json(data);
    }

    if (op === "categoryFather") {
      const categoryId = boundedInt(raw?.categoryId, 1, 99999999, 0);
      if (!categoryId) return json({ error: "invalid_category_id" }, 400);
      const api = new URL("https://" + BHX_HOST + "/gw/Category/CategoryFather");
      for (const [k, v] of Object.entries({ ...ctx, categoryId })) api.searchParams.set(k, String(v));
      const data = await bhxFetch(api.toString(), "https://www.bachhoaxanh.com/", env);
      return json(data);
    }

    if (op === "getCate") {
      const categoryUrl = clean(raw?.categoryUrl).replace(/^\/+|\/+$/g, "");
      if (!/^[a-z0-9-]{1,160}$/i.test(categoryUrl)) {
        return json({ error: "invalid_category_url" }, 400);
      }
      const pageSize = boundedInt(raw?.pageSize, 1, 100, 10);
      const api = new URL("https://" + BHX_HOST + "/gw/Category/V2/GetCate");
      for (const [k, v] of Object.entries({
        ...ctx,
        categoryUrl,
        isMobile: "true",
        isV2: "true",
        pageSize
      })) api.searchParams.set(k, String(v));
      const data = await bhxFetch(api.toString(), webReferer(categoryUrl), env);
      return json(data);
    }

    if (op === "ajaxProduct") {
      const p = raw?.payload && typeof raw.payload === "object" ? raw.payload : {};
      const categoryId = boundedInt(p.CategoryId, 1, 99999999, 0);
      const pageIndex = boundedInt(p.PageIndex, 1, 100, 1);
      const pageSize = boundedInt(p.PageSize, 1, 100, 10);
      if (!categoryId) return json({ error: "invalid_category_id" }, 400);

      const payload = {
        ...ctx,
        CategoryId: categoryId,
        SelectedBrandId: clean(p.SelectedBrandId || ""),
        PropertyIdList: clean(p.PropertyIdList || ""),
        PageIndex: pageIndex,
        PageSize: pageSize,
        SortStr: clean(p.SortStr || ""),
        PriorityProductIds: clean(p.PriorityProductIds || "").slice(0, 12000),
        PropertySelected: Array.isArray(p.PropertySelected) ? p.PropertySelected.slice(0, 50) : [],
        LastShowProductId: boundedInt(p.LastShowProductId, 0, 999999999, 0)
      };
      const api = "https://" + BHX_HOST + "/gw/Category/AjaxProduct";
      const refererSlug = clean(raw?.categoryUrl || "");
      const data = await bhxFetch(api, webReferer(refererSlug), env, payload);
      return json(data);
    }

    if (op === "productDetail") {
      const categoryUrl = clean(raw?.categoryUrl).replace(/^\/+|\/+$/g, "");
      const productUrl = clean(raw?.productUrl).replace(/^\/+|\/+$/g, "");
      if (!/^[a-z0-9-]{1,160}$/i.test(categoryUrl) || !/^[a-z0-9-]{1,240}$/i.test(productUrl)) {
        return json({ error: "invalid_product_url" }, 400);
      }
      const api = new URL("https://" + BHX_HOST + "/gw/Product/GetProductDetail");
      for (const [k, v] of Object.entries({
        ...ctx,
        CategoryUrl: categoryUrl,
        ProductUrl: productUrl
      })) api.searchParams.set(k, String(v));
      const data = await bhxFetch(api.toString(), webReferer(categoryUrl, productUrl), env);
      return json(data);
    }

    return json({ error: "invalid_op" }, 400);
  } catch (error) {
    return json({
      error: "bhx_upstream_failed",
      detail: String(error?.message || error).slice(0, 1200)
    }, 502);
  }
}

function canonicalCategoryUrl(raw) {
  const u = new URL(clean(raw));
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "bachhoaxanh.com") throw new Error("invalid_bhx_url");
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts.length !== 1 || !/^[a-z0-9-]{1,160}$/i.test(parts[0])) {
    throw new Error("bhx_category_url_required");
  }
  return { url: "https://www.bachhoaxanh.com/" + parts[0], slug: parts[0] };
}

function productId(item) {
  return Number(item?.id || item?.productId || item?.productID || item?.ProductId || item?.ProductID || 0) || 0;
}

function productKey(item) {
  const id = productId(item);
  if (id > 0) return "id:" + id;
  const code = clean(item?.productCode || "");
  if (code) return "code:" + code;
  return "url:" + clean(item?.url || "");
}

function isProduct(item) {
  return Boolean(
    item && typeof item === "object" && item.url &&
    (Array.isArray(item.productPrices) || item.price != null || item.sysPrice != null ||
     item.avatar || item.fullName || item.productCode || item.skuInfo)
  );
}

function collectProducts(payload, slug) {
  const map = new Map();
  const walk = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isProduct(item)) {
          try {
            const u = new URL(String(item.url), "https://www.bachhoaxanh.com/");
            const first = u.pathname.split("/").filter(Boolean)[0] || "";
            if (first.toLowerCase() === slug.toLowerCase()) {
              map.set(productKey(item), item);
            }
          } catch {}
        }
        walk(item);
      }
    } else if (value && typeof value === "object") {
      for (const child of Object.values(value)) walk(child);
    }
  };
  walk(payload);
  return [...map.values()];
}

function directProducts(payload, slug) {
  const direct = payload?.data?.products;
  if (Array.isArray(direct)) {
    const map = new Map();
    for (const item of direct) if (isProduct(item)) map.set(productKey(item), item);
    if (map.size) return [...map.values()];
  }
  return collectProducts(payload, slug);
}

function responseCategoryId(payload, products) {
  const infoId = Number(payload?.data?.info?.id) || 0;
  if (infoId > 0) return infoId;
  for (const item of products) {
    const cat = item?.category && typeof item.category === "object" ? item.category : {};
    for (const v of [item?.categoryId, item?.categoryID, cat.id, cat.categoryId, cat.categoryID]) {
      const n = Number(v) || 0;
      if (n > 0) return n;
    }
  }
  return 0;
}

function responsePriorityIds(payload) {
  const ids = payload?.data?.info?.priorityProductIds;
  return Array.isArray(ids)
    ? ids.map(x => Number(x) || 0).filter(Boolean).join(",")
    : clean(ids || "");
}

async function fetchWholeCategory(rawUrl, env) {
  const { url: referer, slug } = canonicalCategoryUrl(rawUrl);
  const pageSize = 10;
  const ctx = fixedContext();

  const firstUrl = new URL("https://" + BHX_HOST + "/gw/Category/V2/GetCate");
  for (const [k, v] of Object.entries({
    ...ctx,
    categoryUrl: slug,
    isMobile: "true",
    isV2: "true",
    pageSize
  })) firstUrl.searchParams.set(k, String(v));

  const started = Date.now();
  const firstBody = await bhxFetch(firstUrl.toString(), referer, env);
  const first = directProducts(firstBody, slug);
  const categoryId = responseCategoryId(firstBody, first);
  if (!categoryId) throw new Error("bhx_category_id_missing");

  const total = Math.max(0, Number(firstBody?.data?.total) || 0);
  const info = firstBody?.data?.info || {};
  const priority = responsePriorityIds(firstBody);
  const map = new Map();
  for (const item of first) map.set(productKey(item), item);

  // BHX GetCate is the initial shelf, while AjaxProduct has its own
  // continuation index. The browser can reach PageIndex 3 after two Ajax
  // loads, so Ajax continuation starts at index 1, not 2.
  let lastShowProductId = 0;
  let pages = 0;
  const maxPage = Math.min(100, Math.max(3, total ? Math.ceil(total / pageSize) + 2 : 50));
  const ajaxUrl = "https://" + BHX_HOST + "/gw/Category/AjaxProduct";

  for (let page = 1; page <= maxPage; page++) {
    if (total > 0 && map.size >= total) break;

    const body = await bhxFetch(ajaxUrl, referer, env, {
      ...ctx,
      CategoryId: categoryId,
      SelectedBrandId: "",
      PropertyIdList: "",
      PageIndex: page,
      PageSize: pageSize,
      SortStr: "",
      PriorityProductIds: priority,
      PropertySelected: [],
      LastShowProductId: lastShowProductId
    });

    const batch = directProducts(body, slug);
    pages = page;
    if (!batch.length) break;

    const before = map.size;
    for (const item of batch) map.set(productKey(item), item);

    const next = productId(batch[batch.length - 1]);
    if (next > 0) lastShowProductId = next;

    // BHX may repeat priority products on consecutive Ajax pages.
    // Keep advancing PageIndex until the API returns an empty batch or total is reached.
    void before;
  }

  return {
    code: 0,
    data: {
      products: [...map.values()],
      total,
      info: {
        id: categoryId,
        name: clean(info.name) || slug,
        url: clean(info.url) || ("/" + slug),
        priorityProductIds: Array.isArray(info.priorityProductIds) ? info.priorityProductIds : []
      },
      transport: {
        engine: "cloudflare-bhx-relay",
        storage: "none",
        pages,
        pageSize,
        ms: Date.now() - started
      }
    }
  };
}


const VNM_GRAPHQL_ORIGIN = "https://open-p04-vn.vinamilk.com.vn";
const VNM_GRAPHQL_PATH = "/api/graphql-pub/";

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value ?? ""));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map(x => x.toString(16).padStart(2, "0"))
    .join("");
}

const VNM_DEFAULT_CLIENT_ID = "54SQs8Rii747anXFUIFsiCxa7kI91drT";
const VNM_DEFAULT_TERMINAL = "2188400000000124";
const VNM_DEFAULT_EXTERNAL_CODE = "35766930226f44e48e8e9f373217cf755";
const VNM_DEFAULT_SIGNATURE_SALT = "89fYD1YM2ESML5nXy6nPz0zOeh6UWauS";
const VNM_DEFAULT_USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";

function vinamilkConfig(env) {
  return {
    clientId: clean(env.VNM_CLIENT_ID || VNM_DEFAULT_CLIENT_ID),
    terminal: clean(env.VNM_X_TERMINAL || VNM_DEFAULT_TERMINAL),
    externalCode: clean(env.VNM_EXTERNAL_CODE || VNM_DEFAULT_EXTERNAL_CODE),
    salt: clean(env.VNM_SIGNATURE_SALT || VNM_DEFAULT_SIGNATURE_SALT),
    deviceInfo: clean(env.VNM_USER_AGENT || VNM_DEFAULT_USER_AGENT)
  };
}

async function vinamilkGraphql(raw, env) {
  const operationName = clean(raw?.operationName);
  const query = String(raw?.query || "");
  const variables = raw?.variables && typeof raw.variables === "object" ? raw.variables : {};
  if (!operationName || !query) throw new Error("vinamilk_graphql_payload_required");

  const cfg = vinamilkConfig(env);
  const body = JSON.stringify({ operationName, variables, query });
  const graphqlHash = await sha256Hex(body);
  const timestamp = String(Date.now());
  const deviceInfo = cfg.deviceInfo;
  const signature = await sha256Hex(
    [VNM_GRAPHQL_PATH, timestamp, deviceInfo, graphqlHash, cfg.salt].join(".")
  );

  const upstream = await fetch(VNM_GRAPHQL_ORIGIN + VNM_GRAPHQL_PATH, {
    method: "POST",
    redirect: "follow",
    headers: {
      "accept": "*/*",
      "content-type": "application/json",
      "origin": "https://www.vinamilk.com.vn",
      "referer": "https://www.vinamilk.com.vn/",
      "client-id": cfg.clientId,
      "x-device-info": deviceInfo,
      "x-external-code": cfg.externalCode,
      "x-graphql-hash": graphqlHash,
      "x-language": "vi",
      "x-signature": signature,
      "x-terminal": cfg.terminal,
      "x-timestamp": timestamp,
      "x-trace-group": operationName,
      "user-agent": deviceInfo
    },
    body
  });
  const responseBody = await upstream.text();
  if (!upstream.ok) {
    throw new Error("vinamilk_graphql_http_" + upstream.status + ":" + responseBody.slice(0, 800));
  }
  let parsed;
  try { parsed = JSON.parse(responseBody); }
  catch { throw new Error("vinamilk_graphql_invalid_json"); }
  if (Array.isArray(parsed?.errors) && parsed.errors.length) {
    throw new Error("vinamilk_graphql_error:" + JSON.stringify(parsed.errors).slice(0, 1000));
  }
  return {
    ok: true,
    upstream_status: upstream.status,
    content_type: clean(upstream.headers.get("content-type") || "application/json"),
    body: responseBody,
    data: parsed?.data ?? null,
    graphql_hash: graphqlHash
  };
}

async function handleVinamilk(request, env) {
  if (!relayAuthorized(request, env)) {
    return json({ error: "unauthorized" }, 401);
  }
  let raw;
  try { raw = await request.json(); }
  catch { return json({ error: "invalid_json" }, 400); }

  try {
    return json(await vinamilkGraphql(raw, env));
  } catch (error) {
    return json({
      error: "vinamilk_relay_failed",
      detail: String(error?.message || error).slice(0, 1200)
    }, 502);
  }
}

async function handleCategory(request, env) {
  if (!relayAuthorized(request, env)) {
    return json({ error: "unauthorized" }, 401);
  }

  let raw;
  try { raw = await request.json(); }
  catch { return json({ error: "invalid_json" }, 400); }
  try {
    return json(await fetchWholeCategory(raw?.url, env));
  } catch (error) {
    return json({
      error: "bhx_category_relay_failed",
      detail: String(error?.message || error).slice(0, 1200)
    }, 502);
  }
}


const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_API_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const YOUTUBE_CLIENTS = [
  {
    name: "TVHTML5",
    id: "7",
    version: "7.20260707.07.00",
    userAgent: "Mozilla/5.0 (ChromiumStylePlatform) Cobalt/25.lts.30.1034943-gold (unlike Gecko), Unknown_TV_Unknown_0/Unknown (Unknown, Unknown)",
    context: {
      clientName: "TVHTML5",
      clientVersion: "7.20260707.07.00",
      hl: "vi",
      gl: "VN"
    }
  },
  {
    name: "TVHTML5_DOWNGRADED",
    id: "7",
    version: "5.20260707",
    userAgent: "Mozilla/5.0 (ChromiumStylePlatform) Cobalt/Version",
    context: {
      clientName: "TVHTML5",
      clientVersion: "5.20260707",
      hl: "vi",
      gl: "VN"
    }
  },
  {
    name: "ANDROID_VR",
    id: "28",
    version: "1.65.10",
    userAgent: "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
    context: {
      clientName: "ANDROID_VR",
      clientVersion: "1.65.10",
      deviceMake: "Oculus",
      deviceModel: "Quest 3",
      androidSdkVersion: 32,
      osName: "Android",
      osVersion: "12L",
      hl: "vi",
      gl: "VN"
    }
  },
  {
    name: "WEB_EMBEDDED_PLAYER",
    id: "56",
    version: "2.20260708.00.00",
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.5 Safari/605.1.15",
    context: {
      clientName: "WEB_EMBEDDED_PLAYER",
      clientVersion: "2.20260708.00.00",
      clientScreen: "EMBED",
      hl: "vi",
      gl: "VN"
    },
    thirdParty: { embedUrl: "https://www.youtube.com/" }
  }
];

function youtubeCors(headers = {}) {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,HEAD,OPTIONS",
    "access-control-allow-headers": "Range,Content-Type",
    "access-control-expose-headers": "Content-Length,Content-Range,Accept-Ranges,Content-Type,X-1988-Cloud",
    ...headers
  };
}

function googleVideoUrl(raw) {
  try {
    const u = new URL(String(raw || ""));
    const host = u.hostname.toLowerCase();
    return (host === "googlevideo.com" || host.endsWith(".googlevideo.com")) ? u.toString() : "";
  } catch {
    return "";
  }
}

function youtubeFormats(player) {
  const streaming = player?.streamingData || {};
  return [
    ...(Array.isArray(streaming.formats) ? streaming.formats : []),
    ...(Array.isArray(streaming.adaptiveFormats) ? streaming.adaptiveFormats : [])
  ].filter((format) => googleVideoUrl(format?.url));
}

function youtubeFormatRank(format, kind) {
  const mime = clean(format?.mimeType).toLowerCase();
  const itag = Number(format?.itag) || 0;
  const bitrate = Number(format?.bitrate) || 0;
  const height = Number(format?.height) || 0;
  const hasAudio = Boolean(format?.audioQuality || format?.audioChannels);
  const hasVideo = Boolean(format?.qualityLabel || format?.width || format?.height);

  if (kind === "audio") {
    const audioOnly = hasAudio && !hasVideo ? 4 : 0;
    const mp4 = mime.includes("audio/mp4") || mime.includes("video/mp4") ? 3 : 0;
    const progressive18 = itag === 18 ? 2 : 0;
    return audioOnly * 1e12 + mp4 * 1e11 + progressive18 * 1e10 + bitrate;
  }

  const progressive = hasAudio && hasVideo ? 5 : 0;
  const progressive18 = itag === 18 ? 4 : 0;
  const mp4 = mime.includes("video/mp4") ? 3 : 0;
  const boundedHeight = Math.min(height || 0, 720);
  return progressive * 1e12 + progressive18 * 1e11 + mp4 * 1e10 + boundedHeight * 1e6 + bitrate;
}

function selectYoutubeFormat(player, kind) {
  return youtubeFormats(player)
    .filter((format) => {
      const hasAudio = Boolean(format?.audioQuality || format?.audioChannels);
      const hasVideo = Boolean(format?.qualityLabel || format?.width || format?.height);
      return kind === "audio" ? hasAudio : (hasAudio && hasVideo);
    })
    .sort((a, b) => youtubeFormatRank(b, kind) - youtubeFormatRank(a, kind))[0] || null;
}

async function youtubePlayer(videoId, client) {
  const endpoint = new URL("https://www.youtube.com/youtubei/v1/player");
  endpoint.searchParams.set("key", YOUTUBE_API_KEY);
  endpoint.searchParams.set("prettyPrint", "false");

  const body = {
    context: {
      client: {
        ...client.context,
        userAgent: client.userAgent
      },
      ...(client.thirdParty ? { thirdParty: client.thirdParty } : {})
    },
    videoId,
    contentCheckOk: true,
    racyCheckOk: true,
    playbackContext: {
      contentPlaybackContext: {
        html5Preference: "HTML5_PREF_WANTS"
      }
    }
  };

  const response = await fetch(endpoint.toString(), {
    method: "POST",
    headers: {
      "accept": "*/*",
      "content-type": "application/json",
      "origin": "https://www.youtube.com",
      "referer": client.name === "WEB_EMBEDDED_PLAYER"
        ? "https://www.youtube.com/embed/" + videoId
        : "https://www.youtube.com/",
      "user-agent": client.userAgent,
      "x-youtube-client-name": client.id,
      "x-youtube-client-version": client.version
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error("youtube_player_http_" + response.status);
  }

  const player = await response.json();
  const status = clean(player?.playabilityStatus?.status || "");
  if (status !== "OK") {
    throw new Error("youtube_player_" + (status || "unavailable"));
  }
  return player;
}

async function probeYoutubeMedia(url, client) {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "accept": "*/*",
      "range": "bytes=0-1",
      "origin": "https://www.youtube.com",
      "referer": "https://www.youtube.com/",
      "user-agent": client.userAgent
    },
    redirect: "follow"
  });
  const ok = response.status === 200 || response.status === 206;
  try { await response.body?.cancel(); } catch {}
  return { ok, status: response.status };
}

async function resolveYoutubeMedia(videoId, kind = "video") {
  if (!YOUTUBE_ID_RE.test(videoId)) throw new Error("invalid_video");
  if (kind !== "video" && kind !== "audio") throw new Error("invalid_kind");

  const errors = [];
  for (const client of YOUTUBE_CLIENTS) {
    try {
      const player = await youtubePlayer(videoId, client);
      const format = selectYoutubeFormat(player, kind);
      if (!format?.url) {
        errors.push(client.name + ":no_direct_format");
        continue;
      }

      const url = googleVideoUrl(format.url);
      if (!url) {
        errors.push(client.name + ":non_googlevideo");
        continue;
      }

      const probe = await probeYoutubeMedia(url, client);
      if (!probe.ok) {
        errors.push(client.name + ":media_http_" + probe.status);
        continue;
      }

      return {
        videoId,
        kind,
        client,
        player,
        format,
        url
      };
    } catch (error) {
      errors.push(client.name + ":" + String(error?.message || error).slice(0, 160));
    }
  }
  throw new Error("youtube_media_unavailable:" + errors.join("|"));
}

async function handleYoutubeResolve(request) {
  const url = new URL(request.url);
  const videoId = clean(url.searchParams.get("id"));
  const kind = clean(url.searchParams.get("kind") || "video");
  if (!YOUTUBE_ID_RE.test(videoId)) return new Response(JSON.stringify({ ok: false, error: "invalid_video" }), {
    status: 400,
    headers: youtubeCors({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
  });

  try {
    const resolved = await resolveYoutubeMedia(videoId, kind);
    const details = resolved.player?.videoDetails || {};
    const base = new URL(request.url);
    base.pathname = "/youtube/media";
    base.search = "";
    base.searchParams.set("id", videoId);
    base.searchParams.set("kind", kind);

    return new Response(JSON.stringify({
      ok: true,
      engine: "cloudflare-innertube",
      data: {
        id: videoId,
        kind,
        title: clean(details.title),
        author: clean(details.author),
        duration: Number(details.lengthSeconds) || 0,
        client: resolved.client.name,
        itag: Number(resolved.format?.itag) || 0,
        mimeType: clean(resolved.format?.mimeType),
        quality: clean(resolved.format?.qualityLabel || resolved.format?.audioQuality),
        mediaUrl: base.toString()
      }
    }), {
      headers: youtubeCors({
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-1988-cloud": resolved.client.name
      })
    });
  } catch (error) {
    return new Response(JSON.stringify({
      ok: false,
      error: "youtube_resolve_failed",
      detail: String(error?.message || error).slice(0, 900)
    }), {
      status: 502,
      headers: youtubeCors({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
    });
  }
}

async function handleYoutubeMedia(request) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: youtubeCors() });

  const requestUrl = new URL(request.url);
  const videoId = clean(requestUrl.searchParams.get("id"));
  const kind = clean(requestUrl.searchParams.get("kind") || "video");
  if (!YOUTUBE_ID_RE.test(videoId)) return new Response("invalid_video", { status: 400, headers: youtubeCors() });

  try {
    const resolved = await resolveYoutubeMedia(videoId, kind);
    const headers = {
      "accept": "*/*",
      "origin": "https://www.youtube.com",
      "referer": "https://www.youtube.com/",
      "user-agent": resolved.client.userAgent
    };
    const incomingRange = request.headers.get("Range");
    if (incomingRange) headers["range"] = incomingRange;

    const upstream = await fetch(resolved.url, {
      method: request.method === "HEAD" ? "HEAD" : "GET",
      headers,
      redirect: "follow"
    });

    if (!(upstream.status === 200 || upstream.status === 206)) {
      try { await upstream.body?.cancel(); } catch {}
      return new Response(JSON.stringify({ ok: false, error: "youtube_upstream_http", status: upstream.status }), {
        status: 502,
        headers: youtubeCors({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
      });
    }

    const responseHeaders = youtubeCors({
      "content-type": upstream.headers.get("content-type") || clean(resolved.format?.mimeType) || "video/mp4",
      "accept-ranges": upstream.headers.get("accept-ranges") || "bytes",
      "cache-control": "no-store",
      "x-1988-cloud": resolved.client.name
    });
    for (const name of ["content-length", "content-range", "etag", "last-modified"]) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders[name] = value;
    }

    if (request.method === "HEAD") {
      try { await upstream.body?.cancel(); } catch {}
      return new Response(null, { status: upstream.status, headers: responseHeaders });
    }
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch (error) {
    return new Response(JSON.stringify({
      ok: false,
      error: "youtube_media_failed",
      detail: String(error?.message || error).slice(0, 900)
    }), {
      status: 502,
      headers: youtubeCors({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
    });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, mode: "bhx-youtube-transport", d1: false });
    }

    if (request.method === "GET" && url.pathname === "/youtube/resolve") {
      return handleYoutubeResolve(request);
    }

    if ((request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") && url.pathname === "/youtube/media") {
      return handleYoutubeMedia(request);
    }

    if (request.method === "POST" && url.pathname === "/bhx") {
      return handleBhx(request, env);
    }

    if (request.method === "POST" && url.pathname === "/category") {
      return handleCategory(request, env);
    }

    if (request.method === "POST" && url.pathname === "/vinamilk") {
      return handleVinamilk(request, env);
    }

    return json({ error: "not_found" }, 404);
  }
};
