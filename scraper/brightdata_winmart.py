#!/usr/bin/env python3
import argparse
import asyncio
import json
import os
import re
import time
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urljoin, urlparse, urlunparse

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
    if original and original <= current:
        original = None

    category = clean_text(first_value(obj, (
        "category2Name", "category_name", "categoryName", "cateName", "category"
    )))
    if isinstance(obj.get("category"), dict):
        category = clean_text(
            first_value(obj["category"], ("name", "label", "title")) or category
        )
    if not category:
        category = clean_text(category_label)

    brand = clean_text(first_value(obj, (
        "brandName", "brand_name", "brand", "manufacturer"
    )))
    if isinstance(obj.get("brand"), dict):
        brand = clean_text(first_value(obj["brand"], ("name", "label")) or brand)

    unit = clean_text(first_value(obj, (
        "unit", "uom", "uomName", "packageUnit", "package_unit",
        "packingUnit", "measureUnit", "unitName"
    )))
    api_unit = normalize_unit(unit)
    name_unit = unit_from_name(name)
    unit = api_unit or name_unit
    unit_evidence = "api_unit" if api_unit else ("name_unit" if name_unit else "")

    packaging = clean_text(first_value(obj, (
        "packaging", "packSize", "pack_size", "unitText", "unit_text"
    )))
    image = image_url([
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
    }


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
            current_category = {"label": top_category_name(target_url)}
            response_tasks = set()

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
                    collector.walk_json(body, response.url, current_category["label"])
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
                    """els => els.map(a => {
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
                        image: realImage
                      };
                    })"""
                )
                for row in rows:
                    href = normalize_product_url(
                        row.get("href") or "", page.url, store_code
                    )
                    if not href:
                        continue
                    text = clean_text(row.get("text") or "")
                    title = clean_text(row.get("title") or "")
                    if len(title) < 4:
                        lines = [clean_text(x) for x in text.split("\n") if clean_text(x)]
                        title = next(
                            (x for x in lines if not re.search(r"\d[\d., ]*\s*(?:₫|đ|VND)", x, re.I)),
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
                    original = max(prices) if len(prices) > 1 and max(prices) > current else None
                    collector.add({
                        "url": href,
                        "name": title,
                        "current_price": current,
                        "original_price": original,
                        "image": image_url(row.get("image") or "", page.url),
                        "brand": "",
                        "unit": unit_from_name(title),
                        "unit_evidence": "name_unit" if unit_from_name(title) else "",
                        "packaging": "",
                        "category_name": category_label,
                        "promotion_text": "",
                    })

            async def scan_page(url: str, category_label: str, discover_subcats: bool):
                current_category["label"] = category_label
                try:
                    await page.goto(url, wait_until="domcontentloaded", timeout=120000)
                except Exception:
                    pass
                await page.wait_for_timeout(1800)
                if discover_subcats:
                    await extract_subcategories()

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
                    await page.wait_for_timeout(1100)
                    count = len(collector.products)
                    if count == previous_count and height == previous_height:
                        stable += 1
                    else:
                        stable = 0
                    previous_count = count
                    previous_height = height
                    if stable >= 4:
                        break

            root_label = top_category_name(target_url)
            await scan_page(target_url, root_label, True)

            subcats = list(collector.subcategories.items())[:40]
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

            # WinMart product detail exposes the authoritative retail body
            # under "Chọn loại" (e.g. the red CHAI button). Fetch detail HTML
            # through the already-open WinMart browser session so we can
            # prioritize that value over title/API guesses without opening
            # hundreds of extra browser tabs. The same pass also recovers
            # og:image/gallery URLs when the category listing only had a
            # placeholder.
            async def enrich_detail_batch(batch):
                payload = [
                    {
                        "url": p.get("url") or "",
                        "name": p.get("name") or "",
                    }
                    for p in batch
                ]
                try:
                    rows = await page.evaluate(
                        """async items => {
                          const UNIT_MAP = {
                            "CHAI":"Chai","LON":"Lon","GÓI":"Gói","GOI":"Gói",
                            "HỘP":"Hộp","HOP":"Hộp","TÚI":"Túi","TUI":"Túi",
                            "BỊCH":"Bịch","BICH":"Bịch","CAN":"Can",
                            "HŨ":"Hũ","HU":"Hũ","LY":"Ly","CÂY":"Cây","CAY":"Cây",
                            "VIÊN":"Viên","VIEN":"Viên","TUÝP":"Tuýp","TUYP":"Tuýp"
                          };
                          const clean = v => String(v || "").replace(/\\s+/g," ").trim();
                          const realImage = (value, base) => {
                            for (const raw of String(value || "").split(",")) {
                              let v = clean(raw).split(/\\s+/)[0] || "";
                              if (!v || /^data:/i.test(v) || /^blob:/i.test(v) ||
                                  /placeholder|transparent/i.test(v)) continue;
                              try { return new URL(v, base).href; } catch {}
                            }
                            return "";
                          };
                          const one = async item => {
                            try {
                              const response = await fetch(item.url, {
                                credentials:"include",
                                cache:"no-store"
                              });
                              if (!response.ok) return {url:item.url};
                              const html = await response.text();
                              const doc = new DOMParser().parseFromString(html,"text/html");

                              let unit = "";
                              let bestScore = -1;
                              const nodes = [...doc.querySelectorAll(
                                "button,[role='button'],label,a,span,div"
                              )];
                              for (const el of nodes) {
                                const raw = clean(el.textContent).toUpperCase();
                                const normalized = UNIT_MAP[raw];
                                if (!normalized) continue;
                                let score = 1;
                                if (el.tagName === "BUTTON") score += 6;
                                if (el.getAttribute("role") === "button") score += 4;
                                const cls = clean(el.className).toLowerCase();
                                if (/active|selected|type|variant|option|btn/.test(cls)) score += 3;
                                let ctx = el;
                                for (let depth=0; depth<4 && ctx; depth++,ctx=ctx.parentElement) {
                                  const t = clean(ctx.textContent).toLowerCase();
                                  if (t.includes("chọn loại") || t.includes("chon loai")) {
                                    score += 12;
                                    break;
                                  }
                                }
                                if (score > bestScore) {
                                  bestScore = score;
                                  unit = normalized;
                                }
                              }

                              // Fallback: inspect a short HTML/text window after "Chọn loại".
                              if (!unit) {
                                const bodyText = clean(doc.body && doc.body.textContent || "");
                                const pos = bodyText.toLowerCase().search(/ch[oọ]n lo[aạ]i/);
                                if (pos >= 0) {
                                  const tail = bodyText.slice(pos, pos + 180).toUpperCase();
                                  for (const [key,label] of Object.entries(UNIT_MAP)) {
                                    if (new RegExp("(^|\\\\s)"+key+"($|\\\\s)").test(tail)) {
                                      unit = label;
                                      break;
                                    }
                                  }
                                }
                              }

                              const imageCandidates = [];
                              const og = doc.querySelector(
                                "meta[property='og:image'],meta[name='og:image']"
                              );
                              if (og) imageCandidates.push(og.getAttribute("content") || "");
                              for (const img of [...doc.querySelectorAll(
                                "img[data-src],img[data-original],img[data-lazy-src],img[srcset],img[src]"
                              )].slice(0,80)) {
                                const alt = clean(img.getAttribute("alt") || "").toLowerCase();
                                const cls = clean(img.className).toLowerCase();
                                const score =
                                  (alt && clean(item.name).toLowerCase().includes(alt) ? 5 : 0) +
                                  (/product|gallery|detail|main/.test(cls) ? 4 : 0);
                                imageCandidates.push({
                                  score,
                                  value:
                                    img.getAttribute("data-src") ||
                                    img.getAttribute("data-original") ||
                                    img.getAttribute("data-lazy-src") ||
                                    img.getAttribute("srcset") ||
                                    img.getAttribute("src") ||
                                    ""
                                });
                              }
                              let image = "";
                              const ordered = imageCandidates
                                .map(x => typeof x === "string" ? {score:20,value:x} : x)
                                .sort((a,b)=>b.score-a.score);
                              for (const x of ordered) {
                                image = realImage(x.value,item.url);
                                if (image) break;
                              }
                              return {url:item.url,unit,image};
                            } catch {
                              return {url:item.url};
                            }
                          };
                          const out = [];
                          for (let i=0;i<items.length;i+=8) {
                            const part = await Promise.all(items.slice(i,i+8).map(one));
                            out.push(...part);
                          }
                          return out;
                        }""",
                        payload,
                    )
                except Exception:
                    return

                by_url = {
                    str(row.get("url") or ""): row
                    for row in rows or []
                    if row and row.get("url")
                }
                for product in batch:
                    row = by_url.get(str(product.get("url") or ""))
                    if not row:
                        continue
                    detail_unit = normalize_unit(row.get("unit") or "")
                    if detail_unit:
                        # Authoritative: the visible "Chọn loại" button wins.
                        product["unit"] = detail_unit
                        product["unit_evidence"] = "detail_type"
                        product["packaging"] = detail_unit
                    detail_image = image_url(row.get("image") or "", product.get("url") or target_url)
                    if detail_image:
                        product["image"] = detail_image

            # Only open detail HTML when the listing/API still lacks a
            # reliable retail unit or a real image. Most WinMart rows already
            # expose these on the category page; avoiding 200+ detail fetches
            # keeps the total-category GET fast. When detail is fetched,
            # "Chọn loại" remains authoritative and overrides guesses.
            detail_candidates = [
                p for p in products
                if not normalize_unit(p.get("unit") or "")
                or not image_url(p.get("image") or "", p.get("url") or target_url)
            ]
            for start in range(0, len(detail_candidates), 40):
                await enrich_detail_batch(detail_candidates[start:start + 40])

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
