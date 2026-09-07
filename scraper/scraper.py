import argparse
import asyncio
import csv
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse, urlunparse

from playwright.async_api import async_playwright

HOST = "bachhoaxanh.com"
DATA_DIR = Path("data")
PRODUCTS_JSON = DATA_DIR / "products.json"
PRODUCTS_CSV = DATA_DIR / "products.csv"
BAD_PATH = ("tin-tuc", "blog", "khuyen-mai", "kinh-nghiem-hay")
PROMO_WORDS = ("ưu đãi", "khuyến mãi", "giảm", "tặng", "mua ", "combo", "quà")
UNIT_WORDS = "gói|chai|lon|hộp|túi|cái|viên|ly|hũ|thùng|lốc|khay"


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def clean(text):
    return re.sub(r"\s+", " ", text or "").strip()


def clean_lines(text):
    return [clean(x) for x in (text or "").splitlines() if clean(x)]


def valid_bhx_url(url):
    try:
        parsed = urlparse(url)
    except Exception:
        return False
    host = (parsed.hostname or "").lower()
    return parsed.scheme in ("http", "https") and host in (HOST, "www." + HOST)


def canonical_url(url):
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    if host == "www." + HOST:
        host = HOST
    path = re.sub(r"/+", "/", parsed.path or "/").rstrip("/") or "/"
    return urlunparse(("https", host, path, "", "", ""))


def product_id(url):
    return hashlib.sha1(canonical_url(url).encode("utf-8")).hexdigest()[:16]


def parse_money(value):
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        n = int(round(float(value)))
        return n if n > 0 else None
    s = clean(str(value)).lower().replace("vnđ", "").replace("₫", "").replace("đ", "")
    digits = re.sub(r"[^0-9]", "", s)
    if not digits:
        return None
    n = int(digits)
    return n if n > 0 else None


def money_candidates(text):
    out = []
    pattern = r"(?<!\d)(\d{1,3}(?:[\.\s]\d{3})+|\d{4,9})\s*(?:₫|đ|vnđ)"
    for raw in re.findall(pattern, text or "", re.I):
        n = parse_money(raw)
        if n and n not in out:
            out.append(n)
    return out


def packaging_info(name, body=""):
    text = clean(f"{name} {body[:3000]}")
    lower = text.lower()
    pack_count = None
    pack_unit = ""
    unit_size = ""

    pack = re.search(
        rf"\b(thùng|lốc|hộp|túi|khay|combo)\s*(\d+)\s*({UNIT_WORDS})?\b",
        lower,
        re.I,
    )
    if not pack:
        pack = re.search(rf"\b(\d+)\s*({UNIT_WORDS})\b", lower, re.I)
        if pack:
            pack_count = int(pack.group(1))
            pack_unit = pack.group(2)
    else:
        pack_count = int(pack.group(2))
        pack_unit = pack.group(3) or ""

    size = re.search(r"\b\d+(?:[\.,]\d+)?\s*(?:kg|g|mg|l|ml)\b", lower, re.I)
    if size:
        unit_size = clean(size.group(0)).replace(" ", "")

    parts = []
    if pack_count:
        prefix = "Thùng" if "thùng" in lower[:120] else ""
        parts.append(clean(f"{prefix} {pack_count} {pack_unit}"))
    if unit_size:
        parts.append(unit_size)

    return {
        "text": " × ".join(x for x in parts if x) or unit_size or "",
        "pack_count": pack_count,
        "pack_unit": pack_unit,
        "unit_size": unit_size,
    }


async def read_jsonld(page):
    out = []
    for raw in await page.locator('script[type="application/ld+json"]').all_text_contents():
        try:
            item = json.loads(raw)
        except Exception:
            continue
        if isinstance(item, list):
            out.extend(item)
        else:
            out.append(item)
    return out


def walk_json(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from walk_json(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk_json(child)


def find_jsonld_type(items, wanted):
    for root in items:
        for item in walk_json(root):
            kind = item.get("@type") if isinstance(item, dict) else None
            kinds = kind if isinstance(kind, list) else [kind]
            if wanted in kinds:
                return item
    return {}


def parse_breadcrumbs(items):
    data = find_jsonld_type(items, "BreadcrumbList")
    result = []
    for entry in data.get("itemListElement") or []:
        if not isinstance(entry, dict):
            continue
        name = entry.get("name")
        if not name and isinstance(entry.get("item"), dict):
            name = entry["item"].get("name")
        name = clean(str(name or ""))
        if name and name not in result:
            result.append(name)
    return result


def source_info(url):
    return {"key": "bachhoaxanh", "name": "Bách Hóa XANH", "host": HOST}


def classify(url, breadcrumbs, name):
    crumbs = [x for x in breadcrumbs if x and x.lower() not in ("trang chủ", "bách hóa xanh")]
    if crumbs and name and clean(crumbs[-1]).lower() == clean(name).lower():
        crumbs = crumbs[:-1]
    path_parts = [x for x in urlparse(url).path.split("/") if x]
    branch_fallback = path_parts[0].replace("-", " ").title() if path_parts else ""
    if len(crumbs) >= 2:
        return crumbs[0], crumbs[-1]
    if len(crumbs) == 1:
        return crumbs[0], branch_fallback or crumbs[0]
    return branch_fallback, branch_fallback


async def first_text(page, selectors):
    for selector in selectors:
        try:
            loc = page.locator(selector)
            if await loc.count():
                text = clean(await loc.first.inner_text(timeout=1500))
                if text:
                    return text
        except Exception:
            pass
    return ""


async def first_attr(page, selectors, attr):
    for selector in selectors:
        try:
            loc = page.locator(selector)
            if await loc.count():
                value = await loc.first.get_attribute(attr)
                if value:
                    return value
        except Exception:
            pass
    return ""


async def dom_price(page, selectors):
    for selector in selectors:
        try:
            texts = await page.locator(selector).all_text_contents()
        except Exception:
            continue
        for text in texts[:20]:
            values = money_candidates(text)
            if values:
                return values[0]
            n = parse_money(text)
            if n and n >= 1000:
                return n
    return None


def promotion_info(body, current_price=None):
    lines = clean_lines(body)
    found = []
    values = []
    for line in lines:
        low = line.lower()
        if not any(word in low for word in PROMO_WORDS):
            continue
        if len(line) > 240:
            continue
        if line not in found:
            found.append(line)
        for value in money_candidates(line):
            if value not in values:
                values.append(value)
        if len(found) >= 4:
            break

    promo_price = None
    plausible = [x for x in values if x >= 1000]
    if plausible:
        below = [x for x in plausible if not current_price or x <= current_price]
        promo_price = min(below or plausible)

    return {
        "active": bool(found),
        "price": promo_price,
        "text": " · ".join(found[:3]),
        "prices_found": plausible[:8],
    }


def offer_price(product):
    offers = product.get("offers") or {}
    if isinstance(offers, list):
        offers = offers[0] if offers else {}
    if not isinstance(offers, dict):
        return None
    for key in ("price", "lowPrice", "highPrice"):
        n = parse_money(offers.get(key))
        if n:
            return n
    return None


async def parse_product_page(page, url):
    items = await read_jsonld(page)
    product = find_jsonld_type(items, "Product")
    body_raw = ""
    try:
        body_raw = await page.locator("body").inner_text(timeout=6000)
    except Exception:
        pass
    body = clean(body_raw)

    name = clean(str(product.get("name") or ""))
    if not name:
        name = await first_text(page, ["h1", '[itemprop="name"]'])
    if not name:
        name = clean(await first_attr(page, ['meta[property="og:title"]'], "content"))

    image = product.get("image") or ""
    if isinstance(image, list):
        image = image[0] if image else ""
    if isinstance(image, dict):
        image = image.get("url") or ""
    if not image:
        image = await first_attr(page, ['meta[property="og:image"]'], "content")

    current = offer_price(product)
    if not current:
        current = await dom_price(page, [
            '[itemprop="price"]',
            '[class*="product"] [class*="price"]',
            'main [class*="price"]',
        ])
    if not current:
        prices = money_candidates(body[:12000])
        current = prices[0] if prices else None

    original = await dom_price(page, [
        "del", "s",
        '[class*="old-price"]',
        '[class*="price-old"]',
        '[class*="original-price"]',
    ])
    if original and current and original <= current:
        original = None

    breadcrumbs = parse_breadcrumbs(items)
    group, branch = classify(url, breadcrumbs, name)
    promo = promotion_info(body_raw, current)
    packaging = packaging_info(name, body)

    if not (bool(product) or bool(name and current)):
        return None

    return {
        "id": product_id(url),
        "source": source_info(url),
        "group": group,
        "branch": branch,
        "name": name,
        "packaging": packaging,
        "price": {"current": current, "original": original},
        "promotion": promo,
        "url": canonical_url(url),
        "image": image or "",
        "breadcrumbs": breadcrumbs,
        "last_checked_at": now_iso(),
    }


async def discover_product_links(page, category_url, limit):
    for _ in range(14):
        await page.mouse.wheel(0, 2400)
        await page.wait_for_timeout(500)

    links = await page.locator("a[href]").evaluate_all(
        "els => els.map(a => a.href).filter(Boolean)"
    )
    base = canonical_url(category_url)
    out = []
    for raw in links:
        try:
            url = canonical_url(raw)
            parsed = urlparse(url)
        except Exception:
            continue
        if parsed.hostname != HOST or url == base:
            continue
        if any("/" + bad in parsed.path.lower() for bad in BAD_PATH):
            continue
        parts = [x for x in parsed.path.split("/") if x]
        if len(parts) < 2:
            continue
        if url not in out:
            out.append(url)
        if len(out) >= limit:
            break
    return out


async def scrape_urls(urls, max_products=40):
    observations = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            locale="vi-VN",
            timezone_id="Asia/Ho_Chi_Minh",
            viewport={"width": 1440, "height": 1000},
        )

        for raw_url in urls:
            if not valid_bhx_url(raw_url):
                continue
            page = await context.new_page()
            try:
                await page.goto(raw_url, wait_until="domcontentloaded", timeout=60000)
                await page.wait_for_timeout(2500)
                parsed = await parse_product_page(page, raw_url)
                if parsed:
                    observations.append(parsed)
                    continue

                links = await discover_product_links(page, raw_url, max_products)
                await page.close()
                page = None
                for url in links:
                    pp = await context.new_page()
                    try:
                        await pp.goto(url, wait_until="domcontentloaded", timeout=35000)
                        await pp.wait_for_timeout(700)
                        item = await parse_product_page(pp, url)
                        if item:
                            observations.append(item)
                    except Exception as error:
                        print("WARN product", url, type(error).__name__, str(error)[:160])
                    finally:
                        await pp.close()
                    if len(observations) >= max_products:
                        break
            except Exception as error:
                print("WARN page", raw_url, type(error).__name__, str(error)[:160])
            finally:
                if page:
                    try:
                        await page.close()
                    except Exception:
                        pass

        await browser.close()
    return observations


def load_db():
    if not PRODUCTS_JSON.exists():
        return {"schema_version": 2, "updated_at": "", "products": []}
    try:
        data = json.loads(PRODUCTS_JSON.read_text("utf-8"))
    except Exception:
        data = {}
    if not isinstance(data, dict):
        data = {}
    data.setdefault("schema_version", 2)
    data.setdefault("updated_at", "")
    data.setdefault("products", [])
    return data


def normalize_watch_arg(value):
    value = str(value or "keep").lower()
    if value == "true":
        return True
    if value == "false":
        return False
    return None


def merge_product(old, observed, my_price=None, watch_override=None):
    old = old or {}
    merged = dict(old)
    for key in (
        "id", "source", "group", "branch", "name", "packaging",
        "price", "promotion", "url", "image", "breadcrumbs", "last_checked_at",
    ):
        merged[key] = observed.get(key)

    merged.setdefault("short_name", old.get("short_name", ""))
    merged.setdefault("note", old.get("note", ""))
    merged["my_price"] = my_price if my_price is not None else old.get("my_price")
    merged["watch"] = watch_override if watch_override is not None else bool(old.get("watch", False))

    history = list(old.get("history") or [])
    history.append({
        "checked_at": observed["last_checked_at"],
        "price": (observed.get("price") or {}).get("current"),
        "original_price": (observed.get("price") or {}).get("original"),
        "promotion_price": (observed.get("promotion") or {}).get("price"),
        "promotion_text": (observed.get("promotion") or {}).get("text", ""),
    })
    merged["history"] = history[-180:]
    return merged


def save_db(db):
    DATA_DIR.mkdir(exist_ok=True)
    db["schema_version"] = 2
    db["updated_at"] = now_iso()
    db["products"] = sorted(
        db["products"],
        key=lambda p: (
            str(p.get("group") or ""),
            str(p.get("branch") or ""),
            str(p.get("name") or ""),
        ),
    )
    PRODUCTS_JSON.write_text(json.dumps(db, ensure_ascii=False, indent=2), encoding="utf-8")

    fields = [
        "source", "group", "branch", "name", "packaging",
        "competitor_price", "original_price", "promotion_price", "promotion_text",
        "my_price", "difference_market_minus_mine", "watch",
        "last_checked_at", "url", "image",
    ]
    with PRODUCTS_CSV.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for p in db["products"]:
            market = parse_money((p.get("price") or {}).get("current"))
            mine = parse_money(p.get("my_price"))
            writer.writerow({
                "source": (p.get("source") or {}).get("name", ""),
                "group": p.get("group", ""),
                "branch": p.get("branch", ""),
                "name": p.get("name", ""),
                "packaging": (p.get("packaging") or {}).get("text", ""),
                "competitor_price": market or "",
                "original_price": (p.get("price") or {}).get("original") or "",
                "promotion_price": (p.get("promotion") or {}).get("price") or "",
                "promotion_text": (p.get("promotion") or {}).get("text", ""),
                "my_price": mine or "",
                "difference_market_minus_mine": (market - mine) if market and mine else "",
                "watch": "true" if p.get("watch") else "false",
                "last_checked_at": p.get("last_checked_at", ""),
                "url": p.get("url", ""),
                "image": p.get("image", ""),
            })


async def main_async(args):
    db = load_db()
    existing = {
        canonical_url(p.get("url", "")): p
        for p in db["products"]
        if p.get("url")
    }

    if args.watchlist:
        urls = [p["url"] for p in db["products"] if p.get("watch") and p.get("url")]
        if not urls:
            print("watchlist empty")
            return 0
        observations = await scrape_urls(urls, max_products=max(len(urls), args.max_products))
        my_price = None
        watch_override = None
    else:
        if not args.url or not valid_bhx_url(args.url):
            raise ValueError("URL phải thuộc bachhoaxanh.com")
        observations = await scrape_urls([args.url], max_products=args.max_products)
        my_price = parse_money(args.my_price)
        watch_override = normalize_watch_arg(args.watch)

    if not observations:
        raise RuntimeError("Không lấy được sản phẩm nào từ URL đã nhập")

    by_url = dict(existing)
    single_override = len(observations) == 1
    for observed in observations:
        key = canonical_url(observed["url"])
        by_url[key] = merge_product(
            by_url.get(key),
            observed,
            my_price=my_price if single_override else None,
            watch_override=watch_override if single_override else None,
        )

    db["products"] = list(by_url.values())
    save_db(db)
    print("updated_products=", len(observations))
    print("total_products=", len(db["products"]))
    return len(observations)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="")
    parser.add_argument("--max-products", type=int, default=40)
    parser.add_argument("--my-price", default="")
    parser.add_argument("--watch", choices=("keep", "true", "false"), default="keep")
    parser.add_argument("--watchlist", action="store_true")
    args = parser.parse_args()
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
