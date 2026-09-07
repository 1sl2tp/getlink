#!/usr/bin/env python3
import argparse
import asyncio
import json
import os
import re
import time
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlencode, urlparse, urlunparse

from playwright.async_api import async_playwright

BLOCK_TYPES = {"image", "media", "font"}


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


async def block_heavy(route):
    if route.request.resource_type in BLOCK_TYPES:
        await route.abort()
    else:
        await route.continue_()


async def wait_queue(queue: asyncio.Queue, timeout: float, predicate=None):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        remaining = max(0.1, deadline - time.monotonic())
        try:
            event = await asyncio.wait_for(queue.get(), timeout=min(1.0, remaining))
        except asyncio.TimeoutError:
            continue
        if predicate is None or predicate(event):
            return event
    raise RuntimeError("api_first_response_timeout")


async def count_bhx(ws_url: str, target_url: str) -> dict:
    started = time.monotonic()
    async with async_playwright() as pw:
        browser = await pw.chromium.connect_over_cdp(ws_url, timeout=60000)
        try:
            page = await browser.new_page()
            await page.route("**/*", block_heavy)
            queue = asyncio.Queue()
            tasks = set()

            async def consume(response):
                try:
                    if response.status != 200:
                        return
                    if "/Category/V2/GetCate" not in response.url:
                        return
                    body = await response.json()
                    data = body.get("data") if isinstance(body, dict) else None
                    if not isinstance(data, dict) or not isinstance(data.get("products"), list):
                        return
                    await queue.put({
                        "url": response.url,
                        "body": body,
                    })
                except Exception:
                    return

            def on_response(response):
                task = asyncio.create_task(consume(response))
                tasks.add(task)
                task.add_done_callback(tasks.discard)

            page.on("response", on_response)
            try:
                await page.goto(target_url, wait_until="domcontentloaded", timeout=90000)
            except Exception:
                pass

            event = await wait_queue(queue, 15)
            data = event["body"]["data"]
            products = data.get("products") or []
            total = int(data.get("total") or len(products))
            return {
                "source": "BHX",
                "url": target_url,
                "pages_total": 1,
                "pages_ok": 1,
                "missing_pages": [],
                "products_total_reported": total,
                "raw_items_checked": len(products),
                "complete_page_scan": True,
                "note": "BHX không phân trang; dùng total do chính GetCate báo.",
                "seconds": round(time.monotonic() - started, 2),
            }
        finally:
            await browser.close()


def winmart_page_url(raw: str, page_number: int) -> str:
    u = urlparse(raw)
    q = parse_qs(u.query, keep_blank_values=True)
    q["pageNumber"] = [str(int(page_number))]
    pairs = []
    for key, values in q.items():
        for value in values:
            pairs.append((key, value))
    return urlunparse((u.scheme, u.netloc, u.path, u.params, urlencode(pairs), u.fragment))


def safe_winmart_headers(headers: dict) -> dict:
    out = {}
    for key, value in (headers or {}).items():
        low = str(key).lower()
        text = str(value or "").strip()
        if not text:
            continue
        if low == "authorization" and text.lower() == "bearer":
            continue
        if low in {"accept", "accept-language", "authorization", "origin", "referer", "user-agent"} or low.startswith("x-"):
            out[key] = text
    return out


def valid_winmart_body(body) -> bool:
    return (
        isinstance(body, dict)
        and isinstance(body.get("data"), dict)
        and isinstance(body["data"].get("items"), list)
        and isinstance(body.get("paging"), dict)
    )


async def count_winmart(ws_url: str, target_url: str) -> dict:
    started = time.monotonic()
    async with async_playwright() as pw:
        browser = await pw.chromium.connect_over_cdp(ws_url, timeout=60000)
        try:
            page = await browser.new_page()
            await page.route("**/*", block_heavy)
            queue = asyncio.Queue()
            tasks = set()

            async def consume(response):
                try:
                    if response.status != 200:
                        return
                    u = urlparse(response.url)
                    if (u.hostname or "").lower() != "api-crownx.winmart.vn":
                        return
                    if "/it/api/web/v3/item/category" not in (u.path or "").lower():
                        return
                    body = await response.json()
                    if not valid_winmart_body(body):
                        return
                    try:
                        headers = await response.request.all_headers()
                    except Exception:
                        headers = {}
                    await queue.put({
                        "url": response.url,
                        "body": body,
                        "headers": headers,
                    })
                except Exception:
                    return

            def on_response(response):
                task = asyncio.create_task(consume(response))
                tasks.add(task)
                task.add_done_callback(tasks.discard)

            page.on("response", on_response)
            try:
                await page.goto(target_url, wait_until="domcontentloaded", timeout=90000)
            except Exception:
                pass

            event = await wait_queue(queue, 15)
            paging = event["body"].get("paging") or {}
            total_pages = max(1, int(paging.get("totalPages") or 1))
            total_count = int(paging.get("totalCount") or 0)
            first_page = int(paging.get("pageNumber") or 1)
            counts = {first_page: len((event["body"].get("data") or {}).get("items") or [])}
            headers = safe_winmart_headers(event.get("headers") or {})

            async def fetch_one(n: int):
                api_url = winmart_page_url(event["url"], n)
                try:
                    response = await page.context.request.get(api_url, headers=headers, timeout=15000)
                    if not response.ok:
                        return n, None, f"http_{response.status}"
                    body = await response.json()
                    if not valid_winmart_body(body):
                        return n, None, "invalid_body"
                    return n, len((body.get("data") or {}).get("items") or []), ""
                except Exception as exc:
                    return n, None, str(exc)[:180]

            remaining = [n for n in range(1, total_pages + 1) if n != first_page]
            semaphore = asyncio.Semaphore(4)

            async def limited(n):
                async with semaphore:
                    return await fetch_one(n)

            results = await asyncio.gather(*[limited(n) for n in remaining])
            failed = []
            for n, count, error in results:
                if count is None:
                    failed.append(n)
                else:
                    counts[n] = count

            # Chỉ retry đúng page lỗi, đúng 1 lần.
            if failed:
                retry_failed = []
                for n in failed:
                    _, count, error = await fetch_one(n)
                    if count is None:
                        retry_failed.append(n)
                    else:
                        counts[n] = count
                failed = retry_failed

            pages_ok = len(counts)
            raw_count = sum(counts.values())
            return {
                "source": "WinMart",
                "url": target_url,
                "pages_total": total_pages,
                "pages_ok": pages_ok,
                "missing_pages": sorted(failed),
                "products_total_reported": total_count,
                "raw_items_across_pages": raw_count,
                "complete_page_scan": pages_ok == total_pages,
                "seconds": round(time.monotonic() - started, 2),
            }
        finally:
            await browser.close()


def valid_go_body(body) -> bool:
    return (
        isinstance(body, dict)
        and body.get("status") == "success"
        and isinstance(body.get("products"), list)
        and isinstance(body.get("pagination"), dict)
    )


async def click_go_more(page) -> bool:
    patterns = [
        re.compile(r"^\\s*Xem\\s+thêm\\s+sản\\s+phẩm\\s*$", re.I),
        re.compile(r"^\\s*Xem\\s+thêm\\s*$", re.I),
    ]
    for pattern in patterns:
        locator = page.get_by_text(pattern)
        try:
            count = await locator.count()
        except Exception:
            count = 0
        for i in range(count):
            el = locator.nth(i)
            try:
                if not await el.is_visible():
                    continue
                await el.scroll_into_view_if_needed(timeout=3000)
                await page.wait_for_timeout(120)
                await el.click(timeout=5000)
                return True
            except Exception:
                continue
    try:
        return bool(await page.evaluate(
            """() => {
              const clean=v=>String(v||"").replace(/\\s+/g," ").trim();
              const nodes=[...document.querySelectorAll("button,a,[role='button']")];
              const hit=nodes.find(el =>
                /^(Xem thêm sản phẩm|Xem thêm)$/i.test(clean(el.innerText||el.textContent)) &&
                el.getBoundingClientRect().width>0 &&
                el.getBoundingClientRect().height>0
              );
              if(!hit)return false;
              hit.scrollIntoView({block:"center"});
              hit.click();
              return true;
            }"""
        ))
    except Exception:
        return False


async def count_go(ws_url: str, target_url: str) -> dict:
    started = time.monotonic()
    async with async_playwright() as pw:
        browser = await pw.chromium.connect_over_cdp(ws_url, timeout=60000)
        try:
            page = await browser.new_page()
            await page.route("**/*", block_heavy)
            queue = asyncio.Queue()
            tasks = set()

            async def consume(response):
                if "/api/order2_listProduct" not in response.url:
                    return
                event = {
                    "url": response.url,
                    "http": response.status,
                    "body": None,
                }
                if response.status == 200:
                    try:
                        body = await response.json()
                    except Exception:
                        body = None
                    if valid_go_body(body):
                        event["body"] = body
                await queue.put(event)

            def on_response(response):
                task = asyncio.create_task(consume(response))
                tasks.add(task)
                task.add_done_callback(tasks.discard)

            page.on("response", on_response)
            try:
                await page.goto(target_url, wait_until="domcontentloaded", timeout=90000)
            except Exception:
                pass

            first = await wait_queue(
                queue,
                15,
                lambda ev: (
                    ev.get("http") == 200
                    and isinstance(ev.get("body"), dict)
                    and int(((ev["body"].get("pagination") or {}).get("current_page") or 1)) == 1
                ),
            )
            first_body = first["body"]
            pagination = first_body.get("pagination") or {}
            total_pages = max(1, int(pagination.get("total_pages") or 1))
            page_size = int(pagination.get("page_size") or 0)
            counts = {1: len(first_body.get("products") or [])}
            errors = {}

            while len(counts) < total_pages:
                clicked = await click_go_more(page)
                if not clicked:
                    break

                known = set(counts)
                try:
                    event = await wait_queue(
                        queue,
                        8,
                        lambda ev: (
                            ev.get("http") != 200
                            or (
                                isinstance(ev.get("body"), dict)
                                and int(((ev["body"].get("pagination") or {}).get("current_page") or 0)) not in known
                            )
                        ),
                    )
                except Exception:
                    break

                if event.get("http") != 200 or not isinstance(event.get("body"), dict):
                    next_page = max(counts) + 1
                    errors[next_page] = f"http_{event.get('http', 0)}"
                    break

                body = event["body"]
                p = body.get("pagination") or {}
                current = int(p.get("current_page") or 0)
                if current <= 0:
                    break
                counts[current] = len(body.get("products") or [])
                print(json.dumps({
                    "go_page": current,
                    "pages_total": total_pages,
                    "items": counts[current],
                }, ensure_ascii=False))
                await page.wait_for_timeout(250)

            missing = [n for n in range(1, total_pages + 1) if n not in counts]
            pages_ok = len(counts)
            raw_count = sum(counts.values())
            metadata = first_body.get("metadata") or {}
            return {
                "source": "GO",
                "url": target_url,
                "store": metadata.get("store"),
                "category": metadata.get("category"),
                "pages_total": total_pages,
                "pages_ok": pages_ok,
                "missing_pages": missing,
                "page_errors": errors,
                "page_size": page_size,
                "raw_items_across_pages": raw_count,
                "complete_page_scan": pages_ok == total_pages,
                "seconds": round(time.monotonic() - started, 2),
                "transport": "site_native_load_more_observed",
            }
        finally:
            await browser.close()


async def run(args):
    base = base_ws_from_env()
    country = (os.environ.get("BRIGHTDATA_COUNTRY") or "vn").strip().lower()
    ws_url = rewrite_ws_country(base, country) if country else base

    if args.source == "bhx":
        result = await count_bhx(ws_url, args.url)
    elif args.source == "winmart":
        result = await count_winmart(ws_url, args.url)
    elif args.source == "go":
        result = await count_go(ws_url, args.url)
    else:
        raise RuntimeError("unsupported_source")

    result["country"] = country or "auto"
    result["test"] = "count_only_no_product_parsing"
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, choices=["bhx", "winmart", "go"])
    parser.add_argument("--url", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    result = None
    code = 0
    try:
        result = asyncio.run(run(args))
        if not result.get("complete_page_scan"):
            code = 2
    except Exception as exc:
        result = {
            "source": args.source,
            "url": args.url,
            "test": "count_only_no_product_parsing",
            "complete_page_scan": False,
            "error": str(exc)[:500],
        }
        code = 1

    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output).write_text(
        json.dumps(result, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print("COUNT_RESULT " + json.dumps(result, ensure_ascii=False))
    raise SystemExit(code)


if __name__ == "__main__":
    main()
