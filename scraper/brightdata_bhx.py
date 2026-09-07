#!/usr/bin/env python3
import argparse
import asyncio
import json
import os
import re
import sys
import time
from pathlib import Path
from urllib.parse import quote, unquote, urlparse, urlunparse

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
                if marker_matches(response.url, kind):
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

            deadline = time.monotonic() + 90
            seen: list[str] = []
            while time.monotonic() < deadline:
                remaining = max(1, deadline - time.monotonic())
                try:
                    response = await asyncio.wait_for(queue.get(), timeout=remaining)
                except asyncio.TimeoutError:
                    break

                seen.append(f"{response.status} {response.url}")
                if response.status != 200:
                    continue
                try:
                    payload = await response.json()
                except Exception:
                    continue

                if (
                    isinstance(payload, dict)
                    and int(payload.get("code", -1)) == 0
                    and payload.get("data") is not None
                ):
                    return payload, response.url

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
                "api_seen": seen[-8:],
            }
            raise RuntimeError("bhx_api_not_captured:" + json.dumps(detail, ensure_ascii=False))
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
