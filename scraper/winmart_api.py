#!/usr/bin/env python3
import argparse
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import parse_qs, quote, urlencode, urlparse, urlunparse
from urllib.request import Request, urlopen

WINMART_HOSTS = {"winmart.vn", "www.winmart.vn"}
API_BASE = "https://api-crownx.winmart.vn/it/api/web/v3/item/category"
DEFAULT_STORE_CODE = "1535"
DEFAULT_STORE_GROUP_CODE = "1998"
PAGE_SIZE = 500


def clean_text(value) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def canonical_winmart(raw: str) -> str:
    u = urlparse(clean_text(raw))
    if (u.hostname or "").lower() not in WINMART_HOSTS:
        raise ValueError("invalid_winmart_url")
    path = re.sub(r"/+", "/", u.path or "/").rstrip("/") or "/"
    q = parse_qs(u.query)
    store = clean_text((q.get("storeCode") or [""])[0])
    cate2 = clean_text((q.get("cate2") or [""])[0])
    pairs = []
    if store:
        pairs.append(("storeCode", store))
    if cate2:
        pairs.append(("cate2", cate2))
    return urlunparse(("https", "winmart.vn", path, "", urlencode(pairs), ""))


def source_slug(target_url: str) -> str:
    u = urlparse(target_url)
    q = parse_qs(u.query)
    cate2 = clean_text((q.get("cate2") or [""])[0])
    if cate2:
        return cate2
    return clean_text((u.path.strip("/").split("/") or [""])[-1])


def store_code(target_url: str) -> str:
    q = parse_qs(urlparse(target_url).query)
    return clean_text((q.get("storeCode") or [DEFAULT_STORE_CODE])[0]) or DEFAULT_STORE_CODE


def api_url(slug: str, store: str, page_number: int) -> str:
    return API_BASE + "?" + urlencode({
        "storeCode": store,
        "slug": slug,
        "pageNumber": int(page_number),
        "pageSize": PAGE_SIZE,
        "orderByDesc": "true",
        "storeGroupCode": DEFAULT_STORE_GROUP_CODE,
    })


def fetch_json(url: str, referer: str, attempts: int = 3) -> dict:
    headers = {
        "Accept": "application/json",
        "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.7",
        "X-API-MERCHANT": "WCM",
        "Origin": "https://winmart.vn",
        "Referer": referer,
        "User-Agent": "Mozilla/5.0",
    }
    last_error = ""
    for attempt in range(attempts):
        try:
            req = Request(url, headers=headers, method="GET")
            with urlopen(req, timeout=20) as response:
                if response.status != 200:
                    raise RuntimeError(f"http_{response.status}")
                return json.loads(response.read().decode("utf-8"))
        except Exception as exc:
            last_error = str(exc)
            if attempt + 1 < attempts:
                time.sleep(0.35 * (attempt + 1))
    raise RuntimeError("winmart_api_failed:" + last_error[:500])


def api_parts(payload: dict):
    data = payload.get("data") if isinstance(payload, dict) else {}
    data = data if isinstance(data, dict) else {}
    items = data.get("items")
    if not isinstance(items, list):
        items = []
    paging = payload.get("paging")
    if not isinstance(paging, dict):
        paging = data.get("paging")
    if not isinstance(paging, dict):
        paging = {}
    return data, items, paging


def parse_money(value):
    if value in (None, ""):
        return None
    try:
        n = round(float(value))
        return n if n > 0 else None
    except Exception:
        digits = re.sub(r"[^0-9]", "", str(value))
        return int(digits) if digits else None


def image_from_value(value):
    if isinstance(value, str):
        text = value.strip()
        if text.startswith("//"):
            return "https:" + text
        if text.startswith("http://") or text.startswith("https://"):
            return text
        return ""
    if isinstance(value, dict):
        for key in (
            "url", "src", "image", "imageUrl", "mediaUrl",
            "thumbnail", "thumbnailUrl", "original",
        ):
            found = image_from_value(value.get(key))
            if found:
                return found
        for child in value.values():
            found = image_from_value(child)
            if found:
                return found
    if isinstance(value, list):
        for child in value:
            found = image_from_value(child)
            if found:
                return found
    return ""


def product_image(item: dict) -> str:
    for key in (
        "mediaUrl", "mediaItems", "imageUrl", "image_url",
        "thumbnailUrl", "thumbnail_url", "thumbnail", "image",
        "images", "imageUrls", "image_urls", "productImage",
        "product_image", "avatar", "picture",
    ):
        found = image_from_value(item.get(key))
        if found:
            return found
    return ""


def product_url(item: dict, store: str) -> str:
    seo = clean_text(item.get("seoName") or item.get("seo_name"))
    if seo:
        return (
            "https://winmart.vn/products/"
            + quote(seo, safe="-._~")
            + "?storeCode="
            + quote(store, safe="")
        )
    raw = clean_text(
        item.get("productUrl")
        or item.get("product_url")
        or item.get("url")
        or item.get("href")
        or ""
    )
    if raw.startswith("/"):
        raw = "https://winmart.vn" + raw
    if raw.startswith("http://") or raw.startswith("https://"):
        try:
            u = urlparse(raw)
            if (u.hostname or "").lower() in WINMART_HOSTS:
                path = re.sub(r"/+", "/", u.path or "/")
                return urlunparse((
                    "https", "winmart.vn", path, "",
                    urlencode({"storeCode": store}), ""
                ))
        except Exception:
            pass
    return ""


def raw_product(item: dict, store: str) -> dict:
    name = clean_text(
        item.get("name")
        or item.get("productName")
        or item.get("product_name")
        or item.get("title")
        or ""
    )

    regular = parse_money(
        item.get("price")
        or item.get("listPrice")
        or item.get("originalPrice")
    )
    sale = parse_money(
        item.get("salePrice")
        or item.get("sellingPrice")
        or item.get("finalPrice")
        or item.get("currentPrice")
    )
    current = sale or regular
    original = regular if regular and current and regular > current else None

    source_type = clean_text(
        item.get("uomName")
        or item.get("unitName")
        or item.get("unit")
        or item.get("packageUnit")
        or item.get("packingUnit")
        or item.get("measureUnit")
        or item.get("uom")
        or ""
    )

    return {
        "url": product_url(item, store),
        "name": name,
        "current_price": current,
        "original_price": original,
        "image": product_image(item),
        "brand": clean_text(
            item.get("brandName")
            or item.get("brand_name")
            or item.get("brand")
            or ""
        ),
        # RAW WinMart sale type. Never map this to Thùng/Giữa/Lẻ here.
        "unit": source_type,
        "unit_evidence": "winmart_api_type" if source_type else "",
        "packaging": source_type,
        "category_name": clean_text(
            item.get("categoryName")
            or item.get("category_name")
            or ""
        ),
        "promotion_text": clean_text(
            item.get("promotionText")
            or item.get("promotion_text")
            or ""
        ),
        "source_product_id": clean_text(item.get("id") or ""),
        "source_item_no": clean_text(
            item.get("itemNo") or item.get("item_no") or ""
        ),
        "source_sku": clean_text(item.get("sku") or ""),
        "barcode": clean_text(item.get("barcode") or ""),
        "source_seo_name": clean_text(item.get("seoName") or ""),
        "source_description": clean_text(item.get("description") or ""),
        "source_short_description": clean_text(
            item.get("shortDescription") or ""
        ),
        "source_uom": clean_text(item.get("uom") or ""),
        "source_uom_name": clean_text(item.get("uomName") or ""),
        "source_quantity_per_unit": item.get("quantityPerUnit"),
    }


def fetch_category(target_url: str) -> dict:
    target_url = canonical_winmart(target_url)
    slug = source_slug(target_url)
    if not slug:
        raise RuntimeError("winmart_category_slug_missing")
    store = store_code(target_url)

    started = time.monotonic()
    first = fetch_json(api_url(slug, store, 1), target_url)
    data, first_items, paging = api_parts(first)
    total_pages = max(1, int(paging.get("totalPages") or 1))
    total_count = int(paging.get("totalCount") or len(first_items))

    pages = {1: first_items}
    failed = []

    if total_pages > 1:
        workers = min(8, total_pages - 1)
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {
                pool.submit(
                    fetch_json,
                    api_url(slug, store, page_number),
                    target_url,
                ): page_number
                for page_number in range(2, total_pages + 1)
            }
            for future in as_completed(futures):
                page_number = futures[future]
                try:
                    _, items, _ = api_parts(future.result())
                    pages[page_number] = items
                except Exception as exc:
                    failed.append({
                        "page": page_number,
                        "error": str(exc)[:300],
                    })

    if failed:
        raise RuntimeError(
            "winmart_api_pages_failed:"
            + json.dumps(failed, ensure_ascii=False)
        )

    # Acquisition layer: preserve every API item in source order.
    source_items = []
    for page_number in sorted(pages):
        source_items.extend(pages[page_number])

    products = [
        raw_product(item, store)
        for item in source_items
        if isinstance(item, dict)
    ]
    elapsed_ms = round((time.monotonic() - started) * 1000)

    print(json.dumps({
        "winmart_direct_api": True,
        "slug": slug,
        "store_code": store,
        "page_size": PAGE_SIZE,
        "total_pages": total_pages,
        "total_count": total_count,
        "api_rows": len(source_items),
        "products": len(products),
        "raw_types": sum(1 for p in products if clean_text(p.get("unit"))),
        "elapsed_ms": elapsed_ms,
    }, ensure_ascii=False))

    return {
        "category_name": clean_text(data.get("name") or slug),
        "store_code": store,
        "subcategories": [],
        "products": products,
        "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source_api": {
            "engine": "winmart-direct-api",
            "slug": slug,
            "page_size": PAGE_SIZE,
            "total_pages": total_pages,
            "total_count": total_count,
            "elapsed_ms": elapsed_ms,
        },
    }


def run(args) -> int:
    target_url = canonical_winmart(args.url)
    request_id = args.request_id or str(int(time.time() * 1000))
    out_path = Path(args.output or f"data/jobs/{request_id}.json")
    out_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        payload = fetch_category(target_url)
        result = {
            "status": "complete",
            "engine": "winmart-direct-api",
            "request_id": request_id,
            "input_url": target_url,
            "kind": "category",
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
            "engine": "winmart-direct-api",
        }, ensure_ascii=False))
        return 0
    except Exception as exc:
        error = {
            "status": "error",
            "error": "winmart_direct_api_failed",
            "detail": str(exc)[:1200],
            "request_id": request_id,
        }
        out_path.write_text(
            json.dumps(error, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(json.dumps(error, ensure_ascii=False))
        return 2


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--request-id", default="")
    parser.add_argument("--output", default="")
    args = parser.parse_args()
    raise SystemExit(run(args))


if __name__ == "__main__":
    main()
