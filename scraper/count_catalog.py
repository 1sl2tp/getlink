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
                try:
                    if response.status != 200 or "/api/order2_listProduct" not in response.url:
                        return
                    body = await response.json()
                    if not valid_go_body(body):
                        return
                    try:
                        payload = response.request.post_data_json
                    except Exception:
                        payload = {}
                    if not isinstance(payload, dict):
                        payload = {}
                    try:
                        headers = await response.request.all_headers()
                    except Exception:
                        headers = {}
                    await queue.put({
                        "url": response.url,
                        "body": body,
                        "payload": payload,
                        "headers": headers,
                    })
                except Exception:
                    return

            def on_response(response):
                task = asyncio.create_task(consume(response))
                tasks.add(task)
                task.add_done_callback(tasks.discard)

            page.on("response", on_response)

            async def open_and_get_first():
                while not queue.empty():
                    try:
                        queue.get_nowait()
                    except Exception:
                        break
                try:
                    await page.goto(target_url, wait_until="domcontentloaded", timeout=90000)
                except Exception:
                    pass
                return await wait_queue(
                    queue,
                    15,
                    lambda ev: int(((ev.get("body") or {}).get("pagination") or {}).get("current_page") or 1) == 1,
                )

            first = await open_and_get_first()
            pagination = first["body"].get("pagination") or {}
            total_pages = max(1, int(pagination.get("total_pages") or 1))
            page_size = int(pagination.get("page_size") or 0)
            first_page = int(pagination.get("current_page") or 1)
            counts = {first_page: len(first["body"].get("products") or [])}

            def safe_fetch_headers(raw):
                out = {}
                for key, value in (raw or {}).items():
                    low = str(key).lower()
                    if low == "content-type" or low == "accept" or low.startswith("x-"):
                        if str(value or "").strip():
                            out[key] = str(value)
                if not any(str(k).lower() == "content-type" for k in out):
                    out["content-type"] = "application/json"
                if not any(str(k).lower() == "accept" for k in out):
                    out["accept"] = "application/json, text/plain, */*"
                return out

            async def browser_fetch(event, n: int):
                payload = dict(event.get("payload") or {})
                payload["page"] = n
                headers = safe_fetch_headers(event.get("headers") or {})
                result = await page.evaluate(
                    """async ({url,payload,headers}) => {
                      try {
                        const ctKey = Object.keys(headers).find(k => k.toLowerCase() === "content-type");
                        const ct = ctKey ? String(headers[ctKey]).toLowerCase() : "application/json";
                        let body;
                        if (ct.includes("application/x-www-form-urlencoded")) {
                          body = new URLSearchParams(Object.entries(payload).map(([k,v]) => [
                            k,
                            Array.isArray(v) ? JSON.stringify(v) : (v === null ? "" : String(v))
                          ])).toString();
                        } else {
                          body = JSON.stringify(payload);
                        }
                        const r = await fetch(url, {
                          method: "POST",
                          credentials: "include",
                          headers,
                          body
                        });
                        let data = null;
                        try { data = await r.json(); } catch {}
                        return {
                          http: r.status,
                          ok: r.ok,
                          success: !!(data && data.status === "success"),
                          count: data && Array.isArray(data.products) ? data.products.length : -1,
                          current_page: data && data.pagination ? Number(data.pagination.current_page || 0) : 0,
                          total_pages: data && data.pagination ? Number(data.pagination.total_pages || 0) : 0
                        };
                      } catch (e) {
                        return {http:0,ok:false,success:false,count:-1,error:String(e)};
                      }
                    }""",
                    {"url": event["url"], "payload": payload, "headers": headers},
                )
                if result.get("ok") and result.get("success") and int(result.get("count", -1)) >= 0:
                    return n, int(result["count"]), ""
                return n, None, f"http_{result.get('http', 0)}"

            missing = []
            # GO được gọi tuần tự trong chính browser/session đang sống.
            for n in range(1, total_pages + 1):
                if n == first_page:
                    continue
                _, count, error = await browser_fetch(first, n)
                if count is None:
                    missing.append(n)
                else:
                    counts[n] = count

            # Nếu có lỗi, reload để lấy request/session mới rồi retry CHỈ page thiếu.
            if missing:
                await page.wait_for_timeout(700)
                fresh = await open_and_get_first()
                retry_missing = []
                for n in missing:
                    _, count, error = await browser_fetch(fresh, n)
                    if count is None:
                        retry_missing.append(n)
                    else:
                        counts[n] = count
                missing = retry_missing
                first = fresh

            pages_ok = len(counts)
            raw_count = sum(counts.values())
            body = first.get("body") or {}
            metadata = body.get("metadata") or {}
            # GO API không có total_count riêng; số raw đếm qua tất cả page là kết quả cần test.
            return {
                "source": "GO",
                "url": target_url,
                "store": metadata.get("store"),
                "category": metadata.get("category"),
                "pages_total": total_pages,
                "pages_ok": pages_ok,
                "missing_pages": sorted(missing),
                "page_size": page_size,
                "raw_items_across_pages": raw_count,
                "complete_page_scan": pages_ok == total_pages,
                "seconds": round(time.monotonic() - started, 2),
                "transport": "in_page_fetch_same_browser_session",
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
