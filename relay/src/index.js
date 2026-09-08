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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, mode: "bhx-transport-only", d1: false });
    }
    if (request.method === "POST" && url.pathname === "/bhx") {
      return handleBhx(request, env);
    }
    if (request.method === "POST" && url.pathname === "/category") {
      return handleCategory(request, env);
    } catch (error) {
        return json({ error: "inspect_links_failed", detail: String(error?.message || error).slice(0, 1000) }, 502);
      }
    } catch (error) {
        return json({ error: "inspect_apis_failed", detail: String(error?.message || error).slice(0, 1000) }, 502);
      }
    }
    return json({ error: "not_found" }, 404);
  }
};
