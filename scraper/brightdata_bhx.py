#!/usr/bin/env python3
import argparse
import asyncio
import json
import os
import re
import sys
import time
from pathlib import Path
from urllib.parse import parse_qs, parse_qsl, quote, unquote, urlencode, urlparse, urlunparse

from playwright.async_api import async_playwright

BHX_HOSTS = {"bachhoaxanh.com", "www.bachhoaxanh.com"}
BLOCK_TYPES = {"image", "media", "font"}
PRODUCT_MARKER = "GetProductDetail"
CATEGORY_MARKERS = ("Category/V2/GetCate", "GetCate")


def canonical_bhx(raw: str) -> str:
    u = urlparse(str(raw or "").strip())
    if (u.hostname or "").lower() not in BHX_HOSTS:
        raise ValueError("invalid_bhx_url")
    path = re.sub(r"/+", "/", u.path or "/").rstrip("/") or "/"
    return urlunparse(("https", "www.bachhoaxanh.com", path, "", "", ""))


def classify(url: str) -> str:
    parts = [x for x in urlparse(url).path.split("/") if x]
    return "product" if len(parts) >= 2 else "category"


def marker_matches(url: str, kind: str) -> bool:
    if kind == "product":
        return PRODUCT_MARKER.lower() in url.lower()
    low = url.lower()
    return any(x.lower() in low for x in CATEGORY_MARKERS)


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
        raise RuntimeError(
            "brightdata_credentials_missing: set BRIGHTDATA_BROWSER_WS "
            "or BRIGHTDATA_BROWSER_USERNAME/BRIGHTDATA_BROWSER_PASSWORD"
        )
    print("Using Bright Data endpoint from username/password")
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
    out: list[str] = []
    for x in values:
        if x not in out:
            out.append(x)
    return out


async def capture_bhx_json(ws_url: str, target_url: str, kind: str) -> tuple[dict, str]:
    async with async_playwright() as pw:
        browser = await pw.chromium.connect_over_cdp(ws_url, timeout=60000)
        try:
            page = await browser.new_page()
            queue: asyncio.Queue = asyncio.Queue()

            async def route_handler(route):
                if route.request.resource_type in BLOCK_TYPES:
                    await route.abort()
                else:
                    await route.continue_()

            await page.route("**/*", route_handler)

            def on_response(response):
                url = response.url.lower()
                should_queue = marker_matches(response.url, kind)
                if kind == "category" and "api.bachhoaxanh.com/" in url and "/gw/" in url:
                    should_queue = True
                if should_queue:
                    try:
                        queue.put_nowait(response)
                    except Exception:
                        pass

            page.on("response", on_response)

            nav_error = None
            try:
                await page.goto(
                    target_url,
                    wait_until="domcontentloaded",
                    timeout=120000,
                )
            except Exception as exc:
                nav_error = exc

            seen: list[str] = []
            category_slug = next(
                (x for x in urlparse(target_url).path.split("/") if x),
                "",
            )

            def category_products_from_payload(payload: dict) -> list[dict]:
                found: list[dict] = []

                def walk(value):
                    if isinstance(value, dict):
                        for child in value.values():
                            walk(child)
                    elif isinstance(value, list):
                        product_like = [
                            x for x in value
                            if isinstance(x, dict)
                            and x.get("url")
                            and (
                                x.get("name")
                                or x.get("fullName")
                                or x.get("productPrices")
                                or x.get("avatar")
                            )
                        ]
                        if product_like:
                            for item in product_like:
                                raw_url = str(item.get("url") or "")
                                try:
                                    p = urlparse(
                                        raw_url
                                        if "://" in raw_url
                                        else "https://www.bachhoaxanh.com/" + raw_url.lstrip("/")
                                    )
                                    parts = [x for x in p.path.split("/") if x]
                                    if (
                                        category_slug
                                        and len(parts) >= 2
                                        and parts[0].lower() == category_slug.lower()
                                    ):
                                        found.append(item)
                                except Exception:
                                    pass
                        for child in value:
                            walk(child)

                walk(payload)
                return found

            async def valid_payload(response):
                seen.append(f"{response.status} {response.url}")
                if response.status != 200:
                    return None
                try:
                    payload = await response.json()
                except Exception:
                    return None
                if (
                    isinstance(payload, dict)
                    and int(payload.get("code", -1)) == 0
                    and payload.get("data") is not None
                ):
                    return payload
                return None

            async def try_api_first_category(response, payload):
                """
                BHX V2/GetCate accepts an arbitrary pageSize. The storefront asks
                for 10 by default, but a larger pageSize returns the whole
                category in one response (confirmed with /sua-tuoi, total=113).
                Reuse the exact live request and only increase pageSize.
                """
                low_url = str(response.url or "").lower()
                if "/category/v2/getcate" not in low_url:
                    return None

                data = payload.get("data") if isinstance(payload, dict) else None
                if not isinstance(data, dict):
                    return None

                first_products = category_products_from_payload(payload)
                try:
                    total = int(data.get("total") or 0)
                except Exception:
                    total = 0
                if total <= 0:
                    total = len(first_products)
                if not first_products:
                    return None

                if len(first_products) >= total:
                    data["_getlink_api_first"] = True
                    data["_getlink_total"] = total
                    data["_getlink_requested_page_size"] = len(first_products)
                    print(json.dumps({
                        "bhx_api_first": True,
                        "total": total,
                        "products": len(first_products),
                        "requested_page_size": len(first_products),
                        "bulk_request": False,
                    }, ensure_ascii=False))
                    return payload, response.url

                # Request exactly the total BHX just reported. This is the same
                # one-shot shape verified manually on /sua-tuoi (total=113).
                # Cap only as a defensive guard; larger categories fall back to
                # the existing scroll merger if BHX ever exceeds it.
                requested_page_size = min(max(total, 1), 2000)

                parsed = urlparse(response.url)
                pairs = parse_qsl(parsed.query, keep_blank_values=True)
                rebuilt = []
                replaced = False
                for key, value in pairs:
                    if key.lower() == "pagesize":
                        rebuilt.append((key, str(requested_page_size)))
                        replaced = True
                    else:
                        rebuilt.append((key, value))
                if not replaced:
                    rebuilt.append(("pageSize", str(requested_page_size)))

                bulk_url = urlunparse((
                    parsed.scheme,
                    parsed.netloc,
                    parsed.path,
                    parsed.params,
                    urlencode(rebuilt),
                    parsed.fragment,
                ))

                # Navigate the same Bright Data Chromium page directly to the
                # enlarged API URL. This mirrors the successful manual test and
                # avoids APIRequestContext/CDP secondary-page restrictions.
                bulk_payload = None
                bulk_status = 0
                last_error = ""
                for attempt in range(2):
                    try:
                        bulk_response = await page.goto(
                            bulk_url,
                            wait_until="domcontentloaded",
                            timeout=60000,
                        )
                        bulk_status = bulk_response.status if bulk_response else 0
                        if bulk_response and bulk_response.ok:
                            bulk_payload = await bulk_response.json()
                            break
                        last_error = f"http_{bulk_status}"
                    except Exception as exc:
                        last_error = str(exc)[:300]
                    await asyncio.sleep(0.6 * (attempt + 1))

                if bulk_payload is None:
                    print(json.dumps({
                        "bhx_api_first": False,
                        "reason": "bulk_browser_navigation_failed",
                        "status": bulk_status,
                        "detail": last_error,
                        "url": bulk_url,
                    }, ensure_ascii=False))
                    # Restore the category page so the old scroll/merge fallback
                    # can still complete the job.
                    try:
                        await page.goto(
                            target_url,
                            wait_until="domcontentloaded",
                            timeout=120000,
                        )
                        await page.wait_for_timeout(800)
                    except Exception:
                        pass
                    return None

                if not (
                    isinstance(bulk_payload, dict)
                    and int(bulk_payload.get("code", -1)) == 0
                    and isinstance(bulk_payload.get("data"), dict)
                ):
                    return None

                bulk_products = category_products_from_payload(bulk_payload)
                unique = {}
                for item in bulk_products:
                    key = str(
                        item.get("url")
                        or item.get("id")
                        or item.get("productCode")
                        or json.dumps(item, ensure_ascii=False, sort_keys=True)[:500]
                    )
                    unique[key] = item
                bulk_products = list(unique.values())

                try:
                    bulk_total = int(bulk_payload["data"].get("total") or total)
                except Exception:
                    bulk_total = total
                expected = max(total, bulk_total)

                print(json.dumps({
                    "bhx_api_first": True,
                    "total": expected,
                    "products": len(bulk_products),
                    "requested_page_size": requested_page_size,
                    "bulk_request": True,
                }, ensure_ascii=False))

                if len(bulk_products) < expected:
                    print(json.dumps({
                        "bhx_api_first_incomplete": True,
                        "expected": expected,
                        "received": len(bulk_products),
                        "fallback": "scroll_merge",
                    }, ensure_ascii=False))
                    return None

                bulk_payload["data"]["products"] = bulk_products
                bulk_payload["data"]["_getlink_api_first"] = True
                bulk_payload["data"]["_getlink_total"] = expected
                bulk_payload["data"]["_getlink_requested_page_size"] = requested_page_size
                return bulk_payload, bulk_url


            if kind == "product":
                deadline = time.monotonic() + 90
                while time.monotonic() < deadline:
                    remaining = max(1, deadline - time.monotonic())
                    try:
                        response = await asyncio.wait_for(queue.get(), timeout=remaining)
                    except asyncio.TimeoutError:
                        break
                    payload = await valid_payload(response)
                    if payload is not None:
                        return payload, response.url
            else:
                # API-first: V2/GetCate can return the whole category when pageSize
                # is increased. Keep the scroll merger below only as a safety fallback.
                first_product_payload = None
                first_product_response_url = ""
                merged: dict[str, dict] = {}
                idle_rounds = 0
                rounds = 0
                terminal_short_page = False
                deadline = time.monotonic() + 75

                def item_key(item: dict) -> str:
                    return str(
                        item.get("url")
                        or item.get("id")
                        or item.get("productCode")
                        or item.get("productId")
                        or json.dumps(item, ensure_ascii=False, sort_keys=True)[:500]
                    )

                while time.monotonic() < deadline and rounds < 36:
                    rounds += 1
                    before = len(merged)
                    drain_until = min(deadline, time.monotonic() + 2.0)

                    while time.monotonic() < drain_until:
                        timeout = max(0.15, drain_until - time.monotonic())
                        try:
                            response = await asyncio.wait_for(queue.get(), timeout=timeout)
                        except asyncio.TimeoutError:
                            break

                        payload = await valid_payload(response)
                        if payload is None:
                            continue

                        api_first = await try_api_first_category(response, payload)
                        if api_first is not None:
                            return api_first

                        products = category_products_from_payload(payload)
                        if products:
                            if first_product_payload is None:
                                first_product_payload = payload
                                first_product_response_url = response.url
                            for item in products:
                                merged[item_key(item)] = item

                            # V2 GetCate exposes pageSize in its URL. If the first real
                            # category page contains fewer products than pageSize, there
                            # cannot be another lazy page: stop immediately instead of
                            # doing several defensive scroll/idle rounds.
                            low_url = response.url.lower()
                            if "/category/v2/getcate" in low_url:
                                try:
                                    query = parse_qs(urlparse(response.url).query.lower())
                                    page_size = int((query.get("pagesize") or ["0"])[0] or 0)
                                except Exception:
                                    page_size = 0
                                if page_size > 0 and len(products) < page_size:
                                    terminal_short_page = True

                    after = len(merged)
                    if after > before:
                        idle_rounds = 0
                        print(
                            json.dumps(
                                {
                                    "category_merge_round": rounds,
                                    "products": after,
                                },
                                ensure_ascii=False,
                            )
                        )
                    else:
                        idle_rounds += 1

                    if merged and terminal_short_page:
                        print(
                            json.dumps(
                                {
                                    "category_terminal_short_page": True,
                                    "products": len(merged),
                                },
                                ensure_ascii=False,
                            )
                        )
                        break

                    try:
                        await page.evaluate(
                            """() => {
                              const h = Math.max(
                                document.body ? document.body.scrollHeight : 0,
                                document.documentElement ? document.documentElement.scrollHeight : 0
                              );
                              const y = Math.min(
                                h,
                                window.scrollY + Math.max(window.innerHeight * 0.85, 700)
                              );
                              window.scrollTo(0, y);
                            }"""
                        )
                        await page.wait_for_timeout(1100)
                    except Exception:
                        pass

                    # After several scrolls without a new GetCate batch, the catalog is exhausted.
                    if merged and idle_rounds >= 5 and rounds >= 6:
                        break

                if merged:
                    # Never forward an arbitrary first /gw/ response.
                    # Build a stable category payload from actual product objects only.
                    first_item = next(iter(merged.values()))
                    category = (
                        first_item.get("category")
                        if isinstance(first_item, dict)
                        and isinstance(first_item.get("category"), dict)
                        else {}
                    )
                    synthetic_payload = {
                        "code": 0,
                        "data": {
                            "products": list(merged.values()),
                            "_getlink_merged_count": len(merged),
                            "_getlink_category_slug": category_slug,
                            "_getlink_category_name": category.get("name", ""),
                        },
                    }
                    print(
                        json.dumps(
                            {
                                "category_merged_products": len(merged),
                                "rounds": rounds,
                            },
                            ensure_ascii=False,
                        )
                    )
                    return synthetic_payload, (
                        first_product_response_url
                        or "getlink://category-merged"
                    )

            title = ""
            final_url = ""
            try:
                title = await page.title()
                final_url = page.url
            except Exception:
                pass
            detail = {
                "navigation_error": str(nav_error)[:400] if nav_error else "",
                "title": title[:200],
                "final_url": final_url[:500],
                "api_seen": seen[-12:],
            }
            raise RuntimeError(
                "bhx_api_not_captured:" + json.dumps(detail, ensure_ascii=False)
            )
        finally:
            await browser.close()


async def run(args) -> int:
    target_url = canonical_bhx(args.url)
    kind = classify(target_url)
    request_id = args.request_id or str(int(time.time() * 1000))
    out_path = Path(args.output or f"data/jobs/{request_id}.json")
    out_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        base_ws = base_ws_from_env()
    except Exception as exc:
        out_path.write_text(
            json.dumps(
                {
                    "status": "error",
                    "error": "brightdata_credentials_missing",
                    "detail": str(exc),
                    "request_id": request_id,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        return 2

    errors = []
    for country in country_candidates():
        label = country or "auto"
        try:
            ws = rewrite_ws_country(base_ws, country)
            payload, response_url = await capture_bhx_json(ws, target_url, kind)
            out_path.write_text(
                json.dumps(
                    {
                        "status": "complete",
                        "engine": "brightdata-browser-api",
                        "request_id": request_id,
                        "input_url": target_url,
                        "kind": kind,
                        "country": label,
                        "response_url": response_url,
                        "bhx_response": payload,
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            print(
                json.dumps(
                    {
                        "status": "complete",
                        "kind": kind,
                        "country": label,
                        "response_url": response_url,
                    },
                    ensure_ascii=False,
                )
            )
            return 0
        except Exception as exc:
            message = f"{label}:{type(exc).__name__}:{str(exc)[:700]}"
            errors.append(message)
            print("WARN", message, file=sys.stderr)

    out_path.write_text(
        json.dumps(
            {
                "status": "error",
                "error": "brightdata_bhx_capture_failed",
                "detail": " | ".join(errors)[-2500:],
                "request_id": request_id,
            },
            ensure_ascii=False,
            indent=2,
        ),
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
