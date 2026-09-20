#!/usr/bin/env python3
import asyncio
import json
import sys
from playwright.async_api import async_playwright

TARGET = "https://www.vinamilk.com.vn/collections/sua-tuoi?src=ALL"
PRODUCT_MARKERS = ("GetEShopProductShelf", "GetEShopProductSelectors")
PRICE_KEYS = ("price", "originPrice", "variantId")

async def main():
    captured = []
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=True,
            args=["--disable-blink-features=AutomationControlled"],
        )
        context = await browser.new_context(
            locale="vi-VN",
            timezone_id="Asia/Ho_Chi_Minh",
            viewport={"width": 390, "height": 844},
            user_agent=(
                "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) "
                "AppleWebKit/605.1.15 (KHTML, like Gecko) "
                "Version/18.5 Mobile/15E148 Safari/604.1"
            ),
            extra_http_headers={
                "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7"
            },
        )
        page = await context.new_page()

        async def inspect_response(response):
            url = response.url
            if "open-p04-vn.vinamilk.com.vn/api/graphql-pub/" not in url:
                return
            try:
                req = response.request
                post = req.post_data or ""
                body = await response.text()
                op = ""
                try:
                    op = (json.loads(post or "{}") or {}).get("operationName") or ""
                except Exception:
                    pass
                record = {
                    "status": response.status,
                    "operation": op,
                    "request_headers": {
                        k: v for k, v in req.headers.items()
                        if k.lower() in {
                            "client-id", "x-graphql-hash", "x-signature", "x-timestamp",
                            "x-terminal", "x-external-code", "x-trace-group"
                        }
                    },
                    "body": body[:200000],
                }
                captured.append(record)
                print("VNM_BROWSER_GQL", json.dumps({
                    "status": record["status"],
                    "operation": op,
                    "signed": bool(record["request_headers"].get("x-signature")),
                    "body_prefix": body[:300].replace("\n", " "),
                }, ensure_ascii=False))
            except Exception as exc:
                print("VNM_BROWSER_CAPTURE_WARN", type(exc).__name__, str(exc)[:240])

        page.on("response", lambda r: asyncio.create_task(inspect_response(r)))

        try:
            await page.goto(TARGET, wait_until="domcontentloaded", timeout=120000)
        except Exception as exc:
            print("VNM_BROWSER_NAV_WARN", type(exc).__name__, str(exc)[:400])

        await page.wait_for_timeout(12000)

        # Trigger additional lazy requests without downloading heavy media.
        try:
            for _ in range(5):
                await page.mouse.wheel(0, 1800)
                await page.wait_for_timeout(1200)
        except Exception:
            pass

        await page.wait_for_timeout(5000)

        title = ""
        try:
            title = await page.title()
        except Exception:
            pass
        print("VNM_BROWSER_PAGE", json.dumps({
            "url": page.url,
            "title": title,
            "graphql_count": len(captured),
        }, ensure_ascii=False))

        await browser.close()

    useful = []
    for row in captured:
        body = row.get("body") or ""
        op = row.get("operation") or ""
        if row.get("status") == 200 and (
            any(m in op for m in PRODUCT_MARKERS)
            or all(k in body for k in ("variantId", "price"))
        ):
            useful.append(row)

    if not useful:
        print("VNM_BROWSER_FAIL no signed product GraphQL captured")
        for row in captured[:12]:
            print("VNM_BROWSER_SEEN", row.get("status"), row.get("operation"))
        return 1

    sample = useful[0]
    body = sample.get("body") or ""
    has_price = all(k in body for k in PRICE_KEYS)
    print("VNM_BROWSER_OK", json.dumps({
        "operation": sample.get("operation"),
        "signed": bool((sample.get("request_headers") or {}).get("x-signature")),
        "has_price_fields": has_price,
        "graphql_count": len(captured),
        "useful_count": len(useful),
    }, ensure_ascii=False))
    return 0

if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
