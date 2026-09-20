#!/usr/bin/env python3
import asyncio
import json
import os
import re
from urllib.parse import quote, unquote, urlparse, urlunparse

from playwright.async_api import async_playwright

TARGET = "https://www.vinamilk.com.vn/collections/sua-tuoi?src=ALL"
PRODUCT_MARKERS = ("GetEShopProductShelf", "GetEShopProductSelectors")
PRICE_KEYS = ("price", "originPrice", "variantId")
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
            print("VNM_BRIGHTDATA_ENDPOINT", name)
            return value

    username = (os.environ.get("BRIGHTDATA_BROWSER_USERNAME") or "").strip()
    password = (os.environ.get("BRIGHTDATA_BROWSER_PASSWORD") or "").strip()
    if not username or not password:
        raise RuntimeError(
            "brightdata_credentials_missing: set BRIGHTDATA_BROWSER_WS "
            "or BRIGHTDATA_BROWSER_USERNAME/BRIGHTDATA_BROWSER_PASSWORD"
        )
    print("VNM_BRIGHTDATA_ENDPOINT username/password")
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
    for value in values:
        if value not in out:
            out.append(value)
    return out


async def capture_signed_graphql(ws_url: str, country: str) -> dict:
    captured = []
    async with async_playwright() as pw:
        browser = await pw.chromium.connect_over_cdp(ws_url, timeout=60000)
        try:
            page = await browser.new_page()

            async def route_handler(route):
                if route.request.resource_type in BLOCK_TYPES:
                    await route.abort()
                    return
                await route.continue_()

            await page.route("**/*", route_handler)

            async def inspect_response(response):
                if "open-p04-vn.vinamilk.com.vn/api/graphql-pub/" not in response.url:
                    return
                try:
                    request = response.request
                    post = request.post_data or ""
                    body = await response.text()
                    operation = ""
                    try:
                        operation = (json.loads(post or "{}") or {}).get("operationName") or ""
                    except Exception:
                        pass
                    headers = {
                        k.lower(): v for k, v in request.headers.items()
                        if k.lower() in {
                            "client-id", "x-graphql-hash", "x-signature", "x-timestamp",
                            "x-terminal", "x-external-code", "x-trace-group"
                        }
                    }
                    record = {
                        "status": response.status,
                        "operation": operation,
                        "headers": headers,
                        "body": body[:250000],
                    }
                    captured.append(record)
                    print("VNM_BRIGHTDATA_GQL", json.dumps({
                        "country": country or "auto",
                        "status": response.status,
                        "operation": operation,
                        "signed": bool(headers.get("x-signature")),
                        "hash": bool(headers.get("x-graphql-hash")),
                        "body_prefix": body[:220].replace("\n", " "),
                    }, ensure_ascii=False))
                except Exception as exc:
                    print("VNM_BRIGHTDATA_CAPTURE_WARN", type(exc).__name__, str(exc)[:240])

            page.on("response", lambda response: asyncio.create_task(inspect_response(response)))

            nav_error = ""
            try:
                await page.goto(TARGET, wait_until="domcontentloaded", timeout=120000)
            except Exception as exc:
                nav_error = f"{type(exc).__name__}:{str(exc)[:400]}"
                print("VNM_BRIGHTDATA_NAV_WARN", nav_error)

            await page.wait_for_timeout(9000)

            # Trigger lazy product groups while keeping heavy media blocked.
            try:
                for _ in range(4):
                    await page.mouse.wheel(0, 1700)
                    await page.wait_for_timeout(1000)
            except Exception:
                pass

            await page.wait_for_timeout(4000)

            title = ""
            try:
                title = await page.title()
            except Exception:
                pass

            useful = []
            for row in captured:
                body = row.get("body") or ""
                operation = row.get("operation") or ""
                headers = row.get("headers") or {}
                if (
                    row.get("status") == 200
                    and headers.get("x-signature")
                    and (
                        any(marker in operation for marker in PRODUCT_MARKERS)
                        or ("variantId" in body and ("price" in body or "packagingValue" in body))
                    )
                ):
                    useful.append(row)

            result = {
                "country": country or "auto",
                "url": page.url,
                "title": title,
                "navigation_error": nav_error,
                "graphql_count": len(captured),
                "useful_count": len(useful),
                "useful": useful,
            }
            print("VNM_BRIGHTDATA_PAGE", json.dumps({
                k: v for k, v in result.items() if k != "useful"
            }, ensure_ascii=False))
            return result
        finally:
            await browser.close()


async def main():
    try:
        base_ws = base_ws_from_env()
    except Exception as exc:
        print("VNM_BRIGHTDATA_CONFIG_FAIL", type(exc).__name__, str(exc)[:500])
        return 2

    attempts = []
    for country in country_candidates():
        label = country or "auto"
        try:
            ws = rewrite_ws_country(base_ws, country)
            result = await capture_signed_graphql(ws, country)
            attempts.append({
                "country": label,
                "title": result.get("title"),
                "graphql_count": result.get("graphql_count"),
                "useful_count": result.get("useful_count"),
            })
            if result.get("useful"):
                sample = result["useful"][0]
                body = sample.get("body") or ""
                headers = sample.get("headers") or {}
                print("VNM_BRIGHTDATA_OK", json.dumps({
                    "country": label,
                    "operation": sample.get("operation"),
                    "signed": bool(headers.get("x-signature")),
                    "has_graphql_hash": bool(headers.get("x-graphql-hash")),
                    "has_price_fields": all(key in body for key in PRICE_KEYS),
                    "graphql_count": result.get("graphql_count"),
                    "useful_count": result.get("useful_count"),
                }, ensure_ascii=False))
                return 0
        except Exception as exc:
            attempts.append({
                "country": label,
                "error": f"{type(exc).__name__}:{str(exc)[:500]}",
            })
            print("VNM_BRIGHTDATA_ATTEMPT_FAIL", json.dumps(attempts[-1], ensure_ascii=False))

    print("VNM_BRIGHTDATA_FAIL", json.dumps(attempts, ensure_ascii=False))
    return 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
