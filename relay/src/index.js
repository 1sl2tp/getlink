const BHX_HOST = "api.bachhoaxanh.com";
const RELAY_HEADER = "x-getlink-relay";
const RELAY_VALUE = "supabase-bhx-v1";

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
  if (request.headers.get(RELAY_HEADER) !== RELAY_VALUE) {
    return json({ error: "unauthorized" }, 401);
  }

  let raw;
  try { raw = await request.json(); }
  catch { return json({ error: "invalid_json" }, 400); }

  const op = clean(raw?.op);
  const ctx = fixedContext();

  try {
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, mode: "bhx-transport-only", d1: false });
    }
    if (request.method === "POST" && url.pathname === "/bhx") {
      return handleBhx(request, env);
    }
    return json({ error: "not_found" }, 404);
  }
};
