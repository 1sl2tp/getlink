#!/usr/bin/env python3
import argparse
import asyncio
import json
import os
import re
import time
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlencode, urljoin, urlparse, urlunparse

from playwright.async_api import async_playwright

WINMART_HOSTS = {"winmart.vn", "www.winmart.vn"}
BLOCK_TYPES = {"media", "font"}


def canonical_winmart(raw: str, store_code: str = "") -> str:
    u = urlparse(str(raw or "").strip())
    if (u.hostname or "").lower() not in WINMART_HOSTS:
        raise ValueError("invalid_winmart_url")
    path = re.sub(r"/+", "/", u.path or "/").rstrip("/") or "/"
    q = parse_qs(u.query)
    store = str((q.get("storeCode") or [store_code or ""])[0] or "").strip()
    cate2 = str((q.get("cate2") or [""])[0] or "").strip()
    query = []
    if store:
        query.append("storeCode=" + quote(store, safe=""))
    if cate2:
        query.append("cate2=" + quote(cate2, safe="-_"))
    return urlunparse(("https", "winmart.vn", path, "", "&".join(query), ""))


def normalize_username_country(username: str, country: str) -> str:
    username = re.sub(r"-country-[a-zA-Z]{2}(?=-|$)", "", username)
    country = (country or "").strip().lower()
    return f"{username}-country-{country}" if country else username


def rewrite_ws_country(ws_url: str, country: str) -> str:
    p = urlparse(ws_url)
    if p.scheme not in {"ws", "wss"}:
        raise ValueError("brightdata_ws_invalid")
    username = unquote(p.username or "")
    password = unquote(p.password or "")
    if not username or not password:
        raise ValueError("brightdata_ws_credentials_missing")
    username = normalize_username_country(username, country)
    host = p.hostname or "brd.superproxy.io"
    port = p.port or 9222
    netloc = f"{quote(username, safe='')}:{quote(password, safe='')}@{host}:{port}"
    return urlunparse((p.scheme, netloc, p.path or "", "", p.query or "", ""))


def base_ws_from_env() -> str:
    for name in ("BRIGHTDATA_BROWSER_WS", "BRIGHTDATA_BROWSER_WSS", "SBR_WS_CDP", "SBR_CDP_URL"):
        value = (os.environ.get(name) or "").strip()
        if value:
            print(f"Using Bright Data endpoint from {name}")
            return value
    username = (os.environ.get("BRIGHTDATA_BROWSER_USERNAME") or "").strip()
    password = (os.environ.get("BRIGHTDATA_BROWSER_PASSWORD") or "").strip()
    if not username or not password:
        raise RuntimeError("brightdata_credentials_missing")
    return (
        "wss://"
        + quote(username, safe="")
        + ":"
        + quote(password, safe="")
        + "@brd.superproxy.io:9222"
    )


def country_candidates() -> list[str]:
    preferred = (os.environ.get("BRIGHTDATA_COUNTRY") or "vn").strip().lower()
    values = [preferred, "sg", ""]
    out = []
    for value in values:
        if value not in out:
            out.append(value)
    return out


def clean_text(value) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def parse_money(value):
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        n = round(float(value))
        return n if n > 0 else None
    digits = re.sub(r"[^0-9]", "", str(value))
    if not digits:
        return None
    n = int(digits)
    return n if n > 0 else None


def first_value(obj: dict, keys: tuple[str, ...]):
    for key in keys:
        if key not in obj:
            continue
        value = obj.get(key)
        if isinstance(value, dict):
            for nested in ("value", "amount", "price", "name", "label", "url"):
                if value.get(nested) not in (None, ""):
                    return value.get(nested)
        elif isinstance(value, list):
            for item in value:
                if item not in (None, ""):
                    if isinstance(item, dict):
                        for nested in ("value", "amount", "price", "name", "label", "url"):
                            if item.get(nested) not in (None, ""):
                                return item.get(nested)
                    else:
                        return item
        elif value not in (None, ""):
            return value
    return None


def normalize_unit(value: str) -> str:
    text = clean_text(value).lower()
    aliases = {
        "chai": "Chai",
        "lon": "Lon",
        "gói": "Gói",
        "goi": "Gói",
        "hộp": "Hộp",
        "hop": "Hộp",
        "túi": "Túi",
        "tui": "Túi",
        "bịch": "Bịch",
        "bich": "Bịch",
        "can": "Can",
        "hũ": "Hũ",
        "hu": "Hũ",
        "ly": "Ly",
        "cây": "Cây",
        "cay": "Cây",
        "viên": "Viên",
        "vien": "Viên",
        "tuýp": "Tuýp",
        "tuyp": "Tuýp",
        "vỉ": "Vỉ",
        "vi": "Vỉ",
    }
    for key, label in aliases.items():
        if re.search(rf"(^|\W){re.escape(key)}($|\W)", text, re.I):
            return label
    return ""


def unit_from_name(name: str) -> str:
    matches = re.findall(
        r"\b(chai|lon|gói|goi|hộp|hop|túi|tui|bịch|bich|can|hũ|hu|ly|cây|cay|viên|vien|tuýp|tuyp)\b",
        clean_text(name).lower(),
        re.I,
    )
    return normalize_unit(matches[-1]) if matches else ""


def top_category_name(url: str) -> str:
    slug = (urlparse(url).path.strip("/").split("/")[-1] or "winmart")
    slug = re.sub(r"--c\d+$", "", slug, flags=re.I)
    words = [x for x in slug.split("-") if x]
    text = " ".join(words)
    return text[:1].upper() + text[1:] if text else "WinMart"


def is_category_url(url: str) -> bool:
    try:
        u = urlparse(url)
        return bool(
            re.search(r"--c\d+$", u.path, re.I)
            or "cate2" in parse_qs(u.query)
        )
    except Exception:
        return False


def normalize_product_url(raw: str, base_url: str, store_code: str) -> str:
    value = clean_text(raw)
    if not value:
        return ""
    if value.startswith("//"):
        value = "https:" + value
    absolute = urljoin(base_url, value)
    u = urlparse(absolute)
    if (u.hostname or "").lower() not in WINMART_HOSTS:
        return ""
    if is_category_url(absolute):
        return ""
    if u.path in {"", "/"}:
        return ""
    return canonical_winmart(absolute, store_code)


def image_url(value, base_url: str) -> str:
    candidates = []

    def collect(v):
        if v in (None, ""):
            return
        if isinstance(v, dict):
            for key in (
                "url", "src", "image", "imageUrl", "image_url",
                "thumbnail", "thumbnailUrl", "thumbnail_url",
                "productImage", "product_image", "large", "medium", "small"
            ):
                if key in v:
                    collect(v.get(key))
            return
        if isinstance(v, list):
            for item in v:
                collect(item)
            return
        text = clean_text(v)
        if text:
            candidates.append(text)

    collect(value)

    for raw in candidates:
        # srcset / lazy-srcset may contain "url 1x, url2 2x".
        parts = [x.strip().split(" ")[0] for x in raw.split(",") if x.strip()]
        for part in parts or [raw]:
            value = clean_text(part)
            low = value.lower()
            if not value:
                continue
            if low.startswith("data:") or low.startswith("blob:"):
                continue
            if "placeholder" in low or "transparent" in low:
                continue
            if value.startswith("//"):
                value = "https:" + value
            elif value.startswith("/"):
                value = urljoin(base_url, value)
            if value.startswith("http://") or value.startswith("https://"):
                return value
    return ""


def candidate_from_dict(obj: dict, base_url: str, store_code: str, category_label: str):
    name = clean_text(first_value(obj, (
        "productName", "product_name", "displayName", "fullName", "name", "title"
    )))
    raw_url = first_value(obj, (
        "productUrl", "product_url", "seoUrl", "seo_url", "url", "href", "link", "slug", "path"
    ))
    if not raw_url:
        seo_name = clean_text(obj.get("seoName") or "")
        if seo_name and re.search(r"--s\d+$", seo_name, re.I):
            raw_url = "https://winmart.vn/products/" + seo_name
    url = normalize_product_url(str(raw_url or ""), base_url, store_code)

    current = None
    for key in (
        "salePrice", "sale_price", "sellingPrice", "selling_price",
        "finalPrice", "final_price", "currentPrice", "current_price", "price"
    ):
        if key in obj:
            current = parse_money(obj.get(key))
            if current:
                break

    if not current:
        prices = obj.get("prices") or obj.get("priceInfo") or obj.get("price_info")
        if isinstance(prices, dict):
            for key in ("salePrice", "sellingPrice", "finalPrice", "currentPrice", "price"):
                current = parse_money(prices.get(key))
                if current:
                    break

    if not name or not url or not current:
        return None

    original = None
    for key in (
        "originalPrice", "original_price", "listPrice", "list_price",
        "basePrice", "base_price", "regularPrice", "regular_price"
    ):
        if key in obj:
            original = parse_money(obj.get(key))
            if original:
                break
    if not original:
        api_list_price = parse_money(obj.get("price"))
        if api_list_price and current and api_list_price > current:
            original = api_list_price
    if original and original <= current:
        original = None

    api_category = clean_text(first_value(obj, (
        "category2Name", "category_name", "categoryName", "cateName", "category"
    )))
    if isinstance(obj.get("category"), dict):
        api_category = clean_text(
            first_value(obj["category"], ("name", "label", "title")) or api_category
        )

    # When scanning a concrete WinMart subcategory (e.g. "Dầu ăn"),
    # that visible category is more specific than a broad API parent
    # such as "Gia vi". Preserve it so BHX taxonomy mapping stays correct.
    page_category = clean_text(category_label)
    page_key = re.sub(r"[^a-z0-9]+", " ", (
        page_category.lower()
        .replace("đ", "d")
    )).strip()
    if page_category and page_key not in {"gia vi", "winmart"}:
        category = page_category
    else:
        category = api_category or page_category

    brand = clean_text(first_value(obj, (
        "brandName", "brand_name", "brand", "manufacturer"
    )))
    if isinstance(obj.get("brand"), dict):
        brand = clean_text(first_value(obj["brand"], ("name", "label")) or brand)

    # WinMart's visible listing card is the authoritative retail-unit source
    # for bulk ingestion. Do not use API uomName and do not infer from title.
    unit = ""
    unit_evidence = ""
    packaging = ""
    image = image_url([
        obj.get("mediaUrl"), obj.get("mediaItems"),
        obj.get("imageUrl"), obj.get("image_url"),
        obj.get("thumbnailUrl"), obj.get("thumbnail_url"),
        obj.get("thumbnail"), obj.get("image"),
        obj.get("images"), obj.get("imageUrls"), obj.get("image_urls"),
        obj.get("productImage"), obj.get("product_image"),
        obj.get("avatar"), obj.get("picture")
    ], base_url)

    promo = clean_text(first_value(obj, (
        "promotionText", "promotion_text", "promoText", "promo_text"
    )))

    return {
        "url": url,
        "name": name,
        "current_price": current,
        "original_price": original,
        "image": image,
        "brand": brand,
        "unit": unit,
        "unit_evidence": unit_evidence,
        "packaging": packaging,
        "category_name": category,
        "promotion_text": promo,

        # Keep source identity fields untouched for the later matching layer.
        # These are metadata only; the scraper must not use them to discard,
        # merge or "correct" products.
        "source_product_id": clean_text(obj.get("id") or ""),
        "source_item_no": clean_text(obj.get("itemNo") or obj.get("item_no") or ""),
        "source_sku": clean_text(obj.get("sku") or ""),
        "barcode": clean_text(obj.get("barcode") or ""),
        "source_seo_name": clean_text(obj.get("seoName") or ""),
        "source_description": clean_text(obj.get("description") or ""),
        "source_short_description": clean_text(obj.get("shortDescription") or ""),
        "source_uom": clean_text(obj.get("uom") or ""),
        "source_uom_name": clean_text(obj.get("uomName") or ""),
        "source_quantity_per_unit": obj.get("quantityPerUnit"),
    }


def winmart_category_api_response(url: str, body) -> bool:
    try:
        u = urlparse(url)
        if (u.hostname or "").lower() != "api-crownx.winmart.vn":
            return False
        if "/it/api/web/v3/item/category" not in (u.path or "").lower():
            return False
        data = body.get("data") if isinstance(body, dict) else None
        paging = body.get("paging") if isinstance(body, dict) else None
        return (
            isinstance(data, dict)
            and isinstance(data.get("items"), list)
            and isinstance(paging, dict)
        )
    except Exception:
        return False


def winmart_api_page_url(raw: str, page_number: int) -> str:
    u = urlparse(raw)
    q = parse_qs(u.query, keep_blank_values=True)
    q["pageNumber"] = [str(int(page_number))]
    pairs = []
    for key, values in q.items():
        for value in values:
            pairs.append((key, value))
    return urlunparse((
        u.scheme, u.netloc, u.path, u.params,
        urlencode(pairs), u.fragment
    ))


def winmart_api_headers(headers: dict) -> dict:
    allowed = {}
    for key, value in (headers or {}).items():
        low = str(key).lower()
        text = str(value or "").strip()
        if not text:
            continue
        if low == "authorization" and text.lower() == "bearer":
            # WinMart currently sends an empty Bearer header for public catalog.
            continue
        if (
            low in {
                "accept", "accept-language", "authorization",
                "origin", "referer", "user-agent"
            }
            or low.startswith("x-")
        ):
            allowed[key] = text
    return allowed


def add_winmart_category_payload(
    collector,
    payload: dict,
    page_url: str,
) -> tuple[int, dict]:
    data = payload.get("data") if isinstance(payload, dict) else {}
    paging = payload.get("paging") if isinstance(payload, dict) else {}
    items = data.get("items") if isinstance(data, dict) else []
    added = 0
    for item in items or []:
        if not isinstance(item, dict):
            continue
        # The API itself gives the concrete categoryName on each item.
        # Prefer it over a broad parent page label such as "Gia vi".
        product = candidate_from_dict(
            item,
            page_url,
            collector.store_code,
            "",
        )
        if product:
            product["discovery_evidence"] = "winmart_category_api"
            before = len(collector.products)
            collector.add(product)
            if len(collector.products) > before:
                added += 1
    return added, paging if isinstance(paging, dict) else {}


class Collector:
    def __init__(self, store_code: str):
        self.store_code = store_code
        self.products: dict[str, dict] = {}
        self.subcategories: dict[str, str] = {}

    def add(self, product: dict | None):
        if not product:
            return
        url = product["url"]
        previous = self.products.get(url)
        if previous:
            merged = dict(previous)
            for key, value in product.items():
                if value not in (None, "", 0):
                    if key == "category_name" and merged.get(key) and value == "Gia vi":
                        continue
                    merged[key] = value
            self.products[url] = merged
        else:
            self.products[url] = product

    def walk_json(self, value, base_url: str, category_label: str):
        if isinstance(value, dict):
            self.add(candidate_from_dict(value, base_url, self.store_code, category_label))
            for child in value.values():
                self.walk_json(child, base_url, category_label)
        elif isinstance(value, list):
            for child in value:
                self.walk_json(child, base_url, category_label)


async def capture_winmart(ws_url: str, target_url: str) -> dict:
    store_code = str((parse_qs(urlparse(target_url).query).get("storeCode") or [""])[0] or "")
    collector = Collector(store_code)

    async with async_playwright() as pw:
        browser = await pw.chromium.connect_over_cdp(ws_url, timeout=60000)
        try:
            page = await browser.new_page()
            current_category = {
                "label": top_category_name(target_url),
                "url": target_url,
            }
            response_tasks = set()
            category_api_events = asyncio.Queue()

            async def route_handler(route):
                if route.request.resource_type in BLOCK_TYPES:
                    await route.abort()
                else:
                    await route.continue_()

            await page.route("**/*", route_handler)

            async def consume_response(response):
                try:
                    if response.status != 200:
                        return
                    if response.request.resource_type not in {"xhr", "fetch"}:
                        return
                    body = await response.json()
                    if winmart_category_api_response(response.url, body):
                        try:
                            request_headers = await response.request.all_headers()
                        except Exception:
                            request_headers = {}
                        await category_api_events.put({
                            "url": response.url,
                            "headers": request_headers,
                            "body": body,
                            "page_url": current_category.get("url") or page.url,
                        })
                        add_winmart_category_payload(
                            collector,
                            body,
                            current_category.get("url") or page.url,
                        )
                        return
                    collector.walk_json(
                        body,
                        response.url,
                        current_category["label"],
                    )
                except Exception:
                    return

            def on_response(response):
                task = asyncio.create_task(consume_response(response))
                response_tasks.add(task)
                task.add_done_callback(response_tasks.discard)

            page.on("response", on_response)

            async def extract_subcategories():
                rows = await page.locator("a[href]").evaluate_all(
                    """els => els.map(a => ({
                      href: a.href || "",
                      text: (a.innerText || a.textContent || "").trim()
                    })).filter(x => x.href.includes("cate2="))"""
                )
                for row in rows:
                    try:
                        href = canonical_winmart(row.get("href") or "", store_code)
                    except Exception:
                        continue
                    label = clean_text(row.get("text") or "")
                    if href and href != target_url:
                        collector.subcategories[href] = label or "Nhóm con"

            async def extract_dom_products(category_label: str):
                rows = await page.locator("a[href]").evaluate_all(
                    """els => {
                      const clean=v=>String(v||"").replace(/\\s+/g," ").trim();
                      const UNIT_MAP = {
                        "CHAI":"Chai","LON":"Lon","GÓI":"Gói","GOI":"Gói",
                        "HỘP":"Hộp","HOP":"Hộp","TÚI":"Túi","TUI":"Túi",
                        "BỊCH":"Bịch","BICH":"Bịch","CAN":"Can",
                        "HŨ":"Hũ","HU":"Hũ","LY":"Ly","CÂY":"Cây","CAY":"Cây",
                        "VIÊN":"Viên","VIEN":"Viên","TUÝP":"Tuýp","TUYP":"Tuýp",
                        "VỈ":"Vỉ","VI":"Vỉ"
                      };
                      const unitOf=root=>{
                        const nodes=[...root.querySelectorAll(
                          "div,span,p,small,label,strong"
                        )];
                        for(const node of nodes){
                          const text=clean(node.textContent).toUpperCase();
                          if(UNIT_MAP[text])return UNIT_MAP[text];
                        }
                        return "";
                      };
                      return els.map(a => {
                        const href = a.href || "";
                        const root =
                          a.closest("article,[class*='product'],[class*='Product'],li") ||
                          a.parentElement ||
                          a;
                        const text = (root.innerText || root.textContent || "").trim();
                        const img = root.querySelector("img");
                        const title =
                          (a.getAttribute("title") || "") ||
                          (img && img.getAttribute("alt")) ||
                          (a.innerText || "").trim();
                        const imageCandidates = img ? [
                          img.currentSrc || "",
                          img.getAttribute("data-src") || "",
                          img.getAttribute("data-original") || "",
                          img.getAttribute("data-lazy-src") || "",
                          img.getAttribute("data-image") || "",
                          img.getAttribute("data-srcset") || "",
                          img.getAttribute("srcset") || "",
                          img.getAttribute("src") || ""
                        ] : [];
                        const realImage = imageCandidates
                          .flatMap(v => String(v || "").split(","))
                          .map(v => v.trim().split(/\s+/)[0])
                          .find(v => v && !/^data:/i.test(v) && !/^blob:/i.test(v)) || "";
                        return {
                          href,
                          text,
                          title,
                          image: realImage,
                          unit: unitOf(root)
                        };
                      });
                    }"""
                )
                for row in rows:
                    href = normalize_product_url(
                        row.get("href") or "", page.url, store_code
                    )
                    if not href:
                        continue

                    visible_unit = normalize_unit(row.get("unit") or "")
                    if visible_unit and href in collector.products:
                        collector.add({
                            **collector.products[href],
                            "unit": visible_unit,
                            "unit_evidence": "listing_card",
                            "packaging": visible_unit,
                        })

                    raw_text = str(row.get("text") or "")
                    text = clean_text(raw_text)
                    title = clean_text(row.get("title") or "")
                    if len(title) < 4:
                        lines = [
                            clean_text(x)
                            for x in raw_text.split("\n")
                            if clean_text(x)
                        ]
                        title = next(
                            (
                                x for x in lines
                                if not re.search(
                                    r"\d[\d., ]*\s*(?:₫|đ|VND)",
                                    x,
                                    re.I,
                                )
                                and normalize_unit(x) == ""
                            ),
                            title,
                        )
                    prices = [
                        parse_money(x)
                        for x in re.findall(
                            r"(\d[\d\s.,]{2,})\s*(?:₫|đ|VND)",
                            text,
                            re.I,
                        )
                    ]
                    prices = [x for x in prices if x]
                    if not title or not prices:
                        continue
                    current = min(prices)
                    original = (
                        max(prices)
                        if len(prices) > 1 and max(prices) > current
                        else None
                    )
                    collector.add({
                        "url": href,
                        "name": title,
                        "current_price": current,
                        "original_price": original,
                        "image": image_url(row.get("image") or "", page.url),
                        "brand": "",
                        "unit": visible_unit,
                        "unit_evidence": "listing_card" if visible_unit else "",
                        "packaging": visible_unit,
                        "category_name": category_label,
                        "promotion_text": "",
                    })

            async def wait_main_category_api(page_url: str):
                deadline = time.monotonic() + 10
                while time.monotonic() < deadline:
                    try:
                        event = await asyncio.wait_for(
                            category_api_events.get(),
                            timeout=min(1.5, max(0.1, deadline - time.monotonic())),
                        )
                    except asyncio.TimeoutError:
                        continue
                    body = event.get("body") or {}
                    if winmart_category_api_response(
                        event.get("url") or "",
                        body,
                    ):
                        return event
                return None

            async def fetch_remaining_api_pages(event, page_url: str):
                body = event.get("body") or {}
                _, paging = add_winmart_category_payload(
                    collector,
                    body,
                    page_url,
                )
                total_pages = int(paging.get("totalPages") or 1)
                total_count = int(paging.get("totalCount") or 0)
                first_page = int(paging.get("pageNumber") or 1)
                headers = winmart_api_headers(event.get("headers") or {})

                async def fetch_one(page_number: int):
                    api_url = winmart_api_page_url(
                        event.get("url") or "",
                        page_number,
                    )
                    last_error = ""
                    for attempt in range(2):
                        try:
                            response = await page.context.request.get(
                                api_url,
                                headers=headers,
                                timeout=20000,
                            )
                            if response.ok:
                                payload = await response.json()
                                if winmart_category_api_response(api_url, payload):
                                    return page_number, payload, ""
                            last_error = "http_" + str(response.status)
                        except Exception as exc:
                            last_error = str(exc)[:300]
                        await asyncio.sleep(0.35 * (attempt + 1))
                    return page_number, None, last_error

                remaining = [
                    n for n in range(1, total_pages + 1)
                    if n != first_page
                ]
                semaphore = asyncio.Semaphore(6)

                async def limited(n):
                    async with semaphore:
                        return await fetch_one(n)

                results = await asyncio.gather(
                    *[limited(n) for n in remaining],
                    return_exceptions=False,
                )

                failed = []
                for page_number, payload, error in sorted(
                    results,
                    key=lambda x: x[0],
                ):
                    if payload is None:
                        failed.append({
                            "page": page_number,
                            "error": error,
                        })
                        continue
                    add_winmart_category_payload(
                        collector,
                        payload,
                        page_url,
                    )

                print(json.dumps({
                    "winmart_category_api": True,
                    "category": clean_text(
                        (body.get("data") or {}).get("name") or ""
                    ),
                    "page_url": page_url,
                    "first_page": first_page,
                    "total_pages": total_pages,
                    "total_count": total_count,
                    "products_collected": len(collector.products),
                    "failed_pages": failed,
                }, ensure_ascii=False))

                if failed:
                    raise RuntimeError(
                        "winmart_category_api_pages_failed:"
                        + json.dumps(failed, ensure_ascii=False)
                    )

            async def enrich_listing_cards(category_label: str):
                stable = 0
                previous_units = -1
                previous_height = -1
                for _ in range(40):
                    await extract_dom_products(category_label)
                    unit_count = sum(
                        1 for product in collector.products.values()
                        if product.get("unit_evidence") == "listing_card"
                        and normalize_unit(product.get("unit") or "")
                    )
                    try:
                        height = await page.evaluate(
                            "() => Math.max(document.body ? document.body.scrollHeight : 0, document.documentElement ? document.documentElement.scrollHeight : 0)"
                        )
                        await page.evaluate(
                            "() => window.scrollTo(0, Math.max(document.body.scrollHeight, document.documentElement.scrollHeight))"
                        )
                    except Exception:
                        height = previous_height
                    await page.wait_for_timeout(550)
                    if unit_count == previous_units and height == previous_height:
                        stable += 1
                    else:
                        stable = 0
                    previous_units = unit_count
                    previous_height = height
                    if stable >= 3:
                        break
                return sum(
                    1 for product in collector.products.values()
                    if product.get("unit_evidence") == "listing_card"
                    and normalize_unit(product.get("unit") or "")
                )

            async def scan_page(url: str, category_label: str, discover_subcats: bool):
                current_category["label"] = category_label
                current_category["url"] = url

                while not category_api_events.empty():
                    try:
                        category_api_events.get_nowait()
                    except asyncio.QueueEmpty:
                        break

                # We only need the navigation to start so the WinMart catalog XHR
                # can fire. Waiting for DOMContentLoaded through Bright Data can block
                # for the full 120s even though the category API has already returned.
                # Keep the browser navigation alive, but release the scraper as soon as
                # the main document is committed.
                nav_started = time.monotonic()
                try:
                    await page.goto(
                        url,
                        wait_until="commit",
                        timeout=35000,
                    )
                except Exception as exc:
                    print(json.dumps({
                        "winmart_navigation_warning": str(exc)[:300],
                        "page_url": url,
                    }, ensure_ascii=False))
                print(json.dumps({
                    "winmart_navigation_ms": round(
                        (time.monotonic() - nav_started) * 1000
                    ),
                    "page_url": url,
                }, ensure_ascii=False))
                await page.wait_for_timeout(500)

                # Root/category navigation is still useful for discovering cate2 links,
                # but product coverage no longer depends on scrolling the DOM.
                if discover_subcats:
                    subcat_stable = 0
                    previous_subcats = -1
                    for _ in range(8):
                        await extract_subcategories()
                        count = len(collector.subcategories)
                        if count == previous_subcats:
                            subcat_stable += 1
                        else:
                            subcat_stable = 0
                        previous_subcats = count
                        if count > 0 and subcat_stable >= 2:
                            break
                        try:
                            await page.evaluate(
                                """() => window.scrollTo(
                                  0,
                                  Math.min(
                                    Math.max(
                                      document.body ? document.body.scrollHeight : 0,
                                      document.documentElement ? document.documentElement.scrollHeight : 0
                                    ),
                                    window.scrollY + Math.max(window.innerHeight * 0.75, 600)
                                  )
                                )"""
                            )
                        except Exception:
                            pass
                        await page.wait_for_timeout(500)

                api_event = await wait_main_category_api(url)
                if api_event:
                    await fetch_remaining_api_pages(api_event, url)
                    listing_units = await enrich_listing_cards(category_label)
                    print(json.dumps({
                        "winmart_listing_units": listing_units,
                        "page_url": url,
                    }, ensure_ascii=False))
                    return True

                # Safety fallback only. If WinMart changes its API shape we still
                # collect visible rows rather than silently returning nothing.
                stable = 0
                previous_count = len(collector.products)
                previous_height = 0
                for _ in range(28):
                    await extract_dom_products(category_label)
                    if discover_subcats:
                        await extract_subcategories()
                    try:
                        height = await page.evaluate(
                            "() => Math.max(document.body ? document.body.scrollHeight : 0, document.documentElement ? document.documentElement.scrollHeight : 0)"
                        )
                        await page.evaluate(
                            "() => window.scrollTo(0, Math.max(document.body.scrollHeight, document.documentElement.scrollHeight))"
                        )
                    except Exception:
                        height = previous_height
                    await page.wait_for_timeout(900)
                    count = len(collector.products)
                    if count == previous_count and height == previous_height:
                        stable += 1
                    else:
                        stable = 0
                    previous_count = count
                    previous_height = height
                    if stable >= 4:
                        break
                print(json.dumps({
                    "winmart_category_api": False,
                    "page_url": url,
                    "fallback_products": len(collector.products),
                }, ensure_ascii=False))
                return False

            root_label = top_category_name(target_url)
            input_has_cate2 = bool(
                parse_qs(urlparse(target_url).query).get("cate2")
            )
            root_api = await scan_page(target_url, root_label, not input_has_cate2)

            subcats = (
                list(collector.subcategories.items())[:80]
                if not input_has_cate2
                else []
            )
            print(json.dumps({
                "winmart_root_api": bool(root_api),
                "winmart_subcategories_found": len(subcats),
                "winmart_products_after_root": len(collector.products),
            }, ensure_ascii=False))

            for index, (url, label) in enumerate(subcats, 1):
                print(json.dumps({
                    "winmart_subcategory": index,
                    "label": label,
                    "url": url,
                    "products_before": len(collector.products),
                }, ensure_ascii=False))
                await scan_page(url, label or root_label, False)

            if response_tasks:
                await asyncio.gather(*list(response_tasks), return_exceptions=True)

            products = list(collector.products.values())
            if not products:
                raise RuntimeError("winmart_no_products_captured")

            listing_unit_count = sum(
                1 for p in products
                if p.get("unit_evidence") == "listing_card"
                and normalize_unit(p.get("unit") or "")
            )
            print(json.dumps({
                "winmart_listing_units": listing_unit_count,
                "winmart_products": len(products),
                "missing_listing_units": len(products) - listing_unit_count,
                "detail_pages_opened": 0,
            }, ensure_ascii=False))

            return {
                "category_name": root_label,
                "store_code": store_code,
                "subcategories": [
                    {"url": url, "name": label}
                    for url, label in collector.subcategories.items()
                ],
                "products": products,
                "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
        finally:
            await browser.close()


async def run(args) -> int:
    target_url = canonical_winmart(args.url)
    request_id = args.request_id or str(int(time.time() * 1000))
    out_path = Path(args.output or f"data/jobs/{request_id}.json")
    out_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        base_ws = base_ws_from_env()
    except Exception as exc:
        out_path.write_text(
            json.dumps({
                "status": "error",
                "error": "brightdata_credentials_missing",
                "detail": str(exc),
                "request_id": request_id,
            }, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return 2

    errors = []
    for country in country_candidates():
        label = country or "auto"
        try:
            ws = rewrite_ws_country(base_ws, country)
            payload = await capture_winmart(ws, target_url)
            result = {
                "status": "complete",
                "engine": "brightdata-browser-winmart",
                "request_id": request_id,
                "input_url": target_url,
                "kind": "category",
                "country": label,
                "checked_at": payload.get("checked_at"),
                "winmart_response": payload,
            }
            out_path.write_text(
                json.dumps(result, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            print(json.dumps({
                "status": "complete",
                "source": "WinMart",
                "products": len(payload.get("products") or []),
                "subcategories": len(payload.get("subcategories") or []),
                "country": label,
            }, ensure_ascii=False))
            return 0
        except Exception as exc:
            errors.append({"country": label, "error": str(exc)[:700]})

    out_path.write_text(
        json.dumps({
            "status": "error",
            "error": "winmart_capture_failed",
            "detail": json.dumps(errors, ensure_ascii=False),
            "request_id": request_id,
            "input_url": target_url,
        }, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return 1


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--request-id", default="")
    parser.add_argument("--output", default="")
    args = parser.parse_args()
    raise SystemExit(asyncio.run(run(args)))


if __name__ == "__main__":
    main()
