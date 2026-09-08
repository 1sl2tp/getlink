#!/usr/bin/env python3
import argparse
import asyncio
import json
import os
import re
import time
from pathlib import Path
from urllib.parse import quote, unquote, urljoin, urlparse, urlunparse

from playwright.async_api import async_playwright

GO_HOSTS = {"sieuthi-go.vn", "www.sieuthi-go.vn"}
GO_STORE_NAME = "GO!"
BLOCK_TYPES = {"media", "font"}


def canonical_go(raw: str) -> str:
    u = urlparse(str(raw or "").strip())
    if (u.hostname or "").lower() not in GO_HOSTS:
        raise ValueError("invalid_go_url")
    path = re.sub(r"/+", "/", u.path or "/").rstrip("/") or "/"
    return urlunparse(("https", "sieuthi-go.vn", path, "", "", ""))


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
    digits = re.sub(r"[^0-9]", "", str(value or ""))
    if not digits:
        return None
    n = int(digits)
    return n if n > 0 else None


def clean_go_product_name(value: str) -> str:
    text = clean_text(value)
    text = re.sub(
        r"\s+tại\s+Siêu\s+thị\s+GO!.*$",
        "",
        text,
        flags=re.I,
    )
    text = re.sub(r"\s*-\s*\d{4,}\s*$", "", text)
    return clean_text(text)


def category_name_from_url(url: str) -> str:
    slug = (urlparse(url).path.strip("/").split("/")[-1] or "go")
    slug = re.sub(r"-i\.\d+$", "", slug, flags=re.I)
    text = clean_text(slug.replace("-", " "))
    return text[:1].upper() + text[1:] if text else "GO!"


async def route_handler(route):
    if route.request.resource_type in BLOCK_TYPES:
        await route.abort()
    else:
        await route.continue_()


async def title_store(page) -> str:
    try:
        title = clean_text(await page.title())
    except Exception:
        title = ""
    m = re.match(r"^(GO!\s*[^|]+)", title, re.I)
    return clean_text(m.group(1)) if m else title


async def prepare_go_page(page, target_url: str):
    # GO! prices are treated as source-wide/default unless the site itself
    # exposes a concrete store context. Do not block ingestion on store name.
    try:
        await page.goto(target_url, wait_until="domcontentloaded", timeout=90000)
    except Exception:
        pass
    await page.wait_for_timeout(1400)


async def extract_products(page, category_label: str):
    rows = await page.locator('a[href*="/product/"]').evaluate_all(
        r"""(anchors, categoryLabel) => {
          const clean=v=>String(v||"").replace(/\s+/g," ").trim();
          const money=v=>{
            const digits=String(v||"").replace(/[^0-9]/g,"");
            return digits?Number(digits):0;
          };
          const realImage=(img)=>{
            if(!img)return "";
            const vals=[
              img.currentSrc,
              img.getAttribute("data-src"),
              img.getAttribute("data-original"),
              img.getAttribute("data-lazy-src"),
              img.getAttribute("src")
            ];
            for(const value of vals){
              const v=clean(value);
              if(!v||/^data:/i.test(v)||/^blob:/i.test(v)||
                 /placeholder|transparent/i.test(v))continue;
              try{return new URL(v,location.href).href}catch{}
            }
            return "";
          };
          const out=[];
          for(const a of anchors){
            const href=a.href||"";
            if(!href||!href.includes("/product/"))continue;

            let root=a;
            for(let i=0;i<7&&root.parentElement;i++){
              const next=root.parentElement;
              const text=clean(next.innerText||next.textContent);
              const hasMoney=/[0-9][0-9.,]*\s*₫/.test(text);
              if(hasMoney && text.length<1800){
                root=next;
                break;
              }
              root=next;
            }

            const img=root.querySelector("img")||a.querySelector("img");
            const heading=root.querySelector("h1,h2,h3,h4,[class*='name'],[class*='title']");
            const name=clean(
              a.getAttribute("title") ||
              (heading&&heading.textContent) ||
              (img&&img.getAttribute("alt")) ||
              a.textContent
            );
            if(!name)continue;

            const priceNodes=[...root.querySelectorAll(
              "[class*='price'],[class*='Price'],strong,b,del,s,strike"
            )];
            let priceTexts=priceNodes
              .map(el=>clean(el.textContent))
              .filter(x=>/[0-9][0-9.,]*\s*₫/.test(x));
            if(!priceTexts.length){
              priceTexts=(clean(root.innerText||root.textContent).match(
                /[0-9][0-9.,]*\s*₫/g
              )||[]);
            }
            const prices=priceTexts.map(money).filter(v=>v>100);
            if(!prices.length)continue;

            const current=Math.min(...prices);
            const original=Math.max(...prices)>current?Math.max(...prices):null;
            out.push({
              url:href,
              name,
              current_price:current,
              original_price:original,
              image:realImage(img),
              brand:"",
              category_name:categoryLabel,
              card_text:clean(root.innerText||root.textContent).slice(0,1800)
            });
          }
          const map=new Map();
          for(const row of out){
            const old=map.get(row.url);
            if(!old || (row.image&&!old.image))map.set(row.url,row);
          }
          return [...map.values()];
        }""",
        category_label,
    )
    return rows or []


async def click_load_more_products(page) -> bool:
    # GO! does not infinite-scroll the whole category. It appends the next
    # batch only after clicking the visible "Xem thêm sản phẩm" control.
    patterns = [
        re.compile(r"^\s*Xem\s+thêm\s+sản\s+phẩm\s*$", re.I),
        re.compile(r"^\s*Xem\s+thêm\s*$", re.I),
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
                await page.wait_for_timeout(150)
                await el.click(timeout=5000)
                await page.wait_for_timeout(1100)
                return True
            except Exception:
                continue

    # Fallback for sites wrapping the label in nested spans.
    try:
        clicked = await page.evaluate(
            r"""() => {
              const clean=v=>String(v||"").replace(/\s+/g," ").trim();
              const nodes=[...document.querySelectorAll("button,a,[role='button']")];
              const hit=nodes.find(el =>
                /^Xem thêm sản phẩm$/i.test(clean(el.innerText||el.textContent)) &&
                el.getBoundingClientRect().width>0 &&
                el.getBoundingClientRect().height>0
              );
              if(!hit)return false;
              hit.scrollIntoView({block:"center"});
              hit.click();
              return true;
            }"""
        )
        if clicked:
            await page.wait_for_timeout(1100)
            return True
    except Exception:
        pass
    return False


def go_detail_value(product: dict, label_pattern: str) -> str:
    for item in product.get("detail") or []:
        if not isinstance(item, dict):
            continue
        name = clean_text(item.get("name") or "")
        if re.search(label_pattern, name, re.I):
            return clean_text(item.get("value") or "")
    return ""


def go_product_url(product: dict, observed_urls: dict) -> str:
    raw_name = clean_text(product.get("name") or "")
    clean_name = clean_go_product_name(raw_name).lower()
    if clean_name and clean_name in observed_urls:
        return observed_urls[clean_name]

    alias = clean_text(product.get("alias") or "").strip("/")
    if alias:
        # GO listing anchors are under /product/. Keep a deterministic URL even
        # when the API batch was never rendered into the DOM.
        return "https://sieuthi-go.vn/product/" + alias

    pid = str(product.get("id") or "").strip()
    if pid:
        return "https://sieuthi-go.vn/product/go-item-" + pid
    return ""


def go_api_product_row(product: dict, category_label: str, observed_urls: dict) -> dict | None:
    if not isinstance(product, dict):
        return None

    raw_name = clean_text(product.get("name") or product.get("meta", {}).get("title") or "")
    name = clean_go_product_name(raw_name)
    price = parse_money(product.get("price"))
    if not name or not price:
        return None

    promo = parse_money(product.get("promotion_price"))
    original = promo if promo and promo > price else None

    thumbnails = product.get("thumbnail") or []
    if isinstance(thumbnails, str):
        thumbnails = [thumbnails]
    image = next((clean_text(x) for x in thumbnails if clean_text(x)), "")
    if not image:
        image = clean_text((product.get("meta") or {}).get("image") or "")

    brand = go_detail_value(product, r"Thương\s*hiệu")
    if brand:
        brand = re.sub(r"\s*\([^)]*\)\s*$", "", brand).strip()
    size = go_detail_value(product, r"Trọng\s*lượng|Dung\s*tích")

    return {
        "url": go_product_url(product, observed_urls),
        "name": name,
        "current_price": price,
        "original_price": original,
        "image": image,
        "brand": brand,
        "category_name": category_label,
        "spec_text": size,
        "barcode": clean_text(product.get("barcode") or ""),
        "product_id": product.get("id"),
        "go_alias": clean_text(product.get("alias") or ""),
        "api_evidence": "go_order2_listProduct",
    }


async def observed_go_product_urls(page) -> dict:
    rows = await page.locator('a[href*="/product/"]').evaluate_all(
        r"""els => els.map(a => ({
          href: a.href || "",
          text: String(
            a.getAttribute("title") ||
            (a.querySelector("img") && a.querySelector("img").getAttribute("alt")) ||
            a.textContent ||
            ""
          ).replace(/\s+/g," ").trim()
        }))"""
    )
    out = {}
    for row in rows or []:
        href = clean_text(row.get("href") or "")
        name = clean_go_product_name(row.get("text") or "").lower()
        if href and name:
            out[name] = href
    return out


def go_list_api_response(url: str, body) -> bool:
    return (
        "/api/order2_listProduct" in str(url or "")
        and isinstance(body, dict)
        and body.get("status") == "success"
        and isinstance(body.get("products"), list)
        and isinstance(body.get("pagination"), dict)
    )


async def capture_go(ws_url: str, target_url: str) -> dict:
    async with async_playwright() as pw:
        browser = await pw.chromium.connect_over_cdp(ws_url, timeout=60000)
        try:
            page = await browser.new_page()
            await page.route("**/*", route_handler)

            api_events = asyncio.Queue()
            response_tasks = set()

            async def consume_response(response):
                try:
                    if response.status != 200:
                        return
                    if "/api/order2_listProduct" not in response.url:
                        return
                    body = await response.json()
                    if not go_list_api_response(response.url, body):
                        return
                    try:
                        request_payload = response.request.post_data_json
                    except Exception:
                        request_payload = None
                    if not isinstance(request_payload, dict):
                        try:
                            request_payload = json.loads(response.request.post_data or "{}")
                        except Exception:
                            request_payload = {}
                    try:
                        request_headers = await response.request.all_headers()
                    except Exception:
                        request_headers = {}
                    await api_events.put({
                        "url": response.url,
                        "body": body,
                        "payload": request_payload,
                        "headers": request_headers,
                    })
                except Exception:
                    return

            def on_response(response):
                task = asyncio.create_task(consume_response(response))
                response_tasks.add(task)
                task.add_done_callback(response_tasks.discard)

            page.on("response", on_response)
            await prepare_go_page(page, target_url)

            category_label = category_name_from_url(target_url)

            first_event = None
            deadline = time.monotonic() + 12
            while time.monotonic() < deadline and first_event is None:
                try:
                    first_event = await asyncio.wait_for(
                        api_events.get(),
                        timeout=min(1.5, max(0.1, deadline - time.monotonic())),
                    )
                except asyncio.TimeoutError:
                    pass

            if first_event:
                first_body = first_event["body"]
                pagination = first_body.get("pagination") or {}
                total_pages = max(1, int(pagination.get("total_pages") or 1))
                page_size = int(pagination.get("page_size") or 15)
                base_payload = dict(first_event.get("payload") or {})

                # Exact payload confirmed from GO Network:
                # page, category, filter_brand, filter_subfamily, search,
                # store, sitecode, platform, lang.
                # Preserve the live request and change only page.
                base_payload.setdefault("filter_brand", [])
                base_payload.setdefault("filter_subfamily", [])
                base_payload.setdefault("search", None)
                base_payload.setdefault("platform", 2)
                base_payload.setdefault("lang", "vi")

                observed_urls = await observed_go_product_urls(page)
                products = {}

                def add_body(body):
                    for raw_product in body.get("products") or []:
                        row = go_api_product_row(
                            raw_product,
                            category_label,
                            observed_urls,
                        )
                        if not row or not row.get("url"):
                            continue
                        key = str(
                            raw_product.get("id") or
                            raw_product.get("barcode") or
                            row["url"]
                        )
                        products[key] = row

                add_body(first_body)

                api_headers = {}
                for key, value in (first_event.get("headers") or {}).items():
                    low = str(key).lower()
                    if low in {
                        "accept", "accept-language", "content-type",
                        "origin", "referer", "user-agent"
                    } or low.startswith("x-"):
                        api_headers[key] = value

                async def fetch_page(page_number: int):
                    payload = dict(base_payload)
                    payload["page"] = page_number
                    last_error = ""
                    for attempt in range(3):
                        try:
                            response = await page.context.request.post(
                                first_event["url"],
                                data=payload,
                                headers=api_headers,
                                timeout=25000,
                            )
                            if response.ok:
                                body = await response.json()
                                if go_list_api_response(first_event["url"], body):
                                    return page_number, body, ""
                            last_error = "http_" + str(response.status)
                        except Exception as exc:
                            last_error = str(exc)[:300]
                        await asyncio.sleep(0.4 * (attempt + 1))
                    return page_number, None, last_error

                first_page = int(pagination.get("current_page") or base_payload.get("page") or 1)
                remaining = [
                    n for n in range(1, total_pages + 1)
                    if n != first_page
                ]
                semaphore = asyncio.Semaphore(8)

                async def limited(n):
                    async with semaphore:
                        return await fetch_page(n)

                results = await asyncio.gather(
                    *[limited(n) for n in remaining],
                    return_exceptions=False,
                )

                failed_pages = []
                for page_number, body, error in sorted(results, key=lambda x: x[0]):
                    if body is None:
                        failed_pages.append({"page": page_number, "error": error})
                        continue
                    add_body(body)

                print(json.dumps({
                    "go_api": "order2_listProduct",
                    "category": base_payload.get("category"),
                    "store": base_payload.get("store"),
                    "sitecode": base_payload.get("sitecode"),
                    "total_pages": total_pages,
                    "page_size": page_size,
                    "products_loaded": len(products),
                    "failed_pages": failed_pages,
                    "detail_pages_opened": 0,
                    "load_more_clicks": 0,
                }, ensure_ascii=False))

                if failed_pages:
                    raise RuntimeError(
                        "go_api_pages_failed:" +
                        json.dumps(failed_pages, ensure_ascii=False)
                    )
                if not products:
                    raise RuntimeError("go_api_no_products")

                return {
                    "category_name": category_label,
                    "store_name": "GO!",
                    "store_code": base_payload.get("store"),
                    "sitecode": base_payload.get("sitecode"),
                    "total_pages": total_pages,
                    "page_size": page_size,
                    "products": list(products.values()),
                    "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                }

            # Fallback only if GO changes the API or the first request was not
            # observable. This keeps the old UI click path as a safety net.
            products = {}
            stable = 0
            previous_count = -1
            previous_height = -1
            load_more_clicks = 0

            for _ in range(60):
                for row in await extract_products(page, category_label):
                    products[row["url"]] = row

                clicked_more = await click_load_more_products(page)
                if clicked_more:
                    load_more_clicks += 1
                    stable = 0
                    previous_count = len(products)
                    previous_height = -1
                    continue

                try:
                    height = await page.evaluate(
                        "() => Math.max(document.body ? document.body.scrollHeight : 0, document.documentElement ? document.documentElement.scrollHeight : 0)"
                    )
                    await page.evaluate(
                        "() => window.scrollTo(0, Math.max(document.body.scrollHeight, document.documentElement.scrollHeight))"
                    )
                except Exception:
                    height = previous_height
                await page.wait_for_timeout(800)

                count = len(products)
                if count == previous_count and height == previous_height:
                    stable += 1
                else:
                    stable = 0
                previous_count = count
                previous_height = height
                if stable >= 3:
                    break

            print(json.dumps({
                "go_api": "fallback_dom",
                "go_products_loaded": len(products),
                "go_load_more_clicks": load_more_clicks,
            }, ensure_ascii=False))

            if not products:
                raise RuntimeError("go_no_products_captured")

            return {
                "category_name": category_label,
                "store_name": "GO!",
                "products": list(products.values()),
                "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
        finally:
            await browser.close()


async def run(args) -> int:
    target_url = canonical_go(args.url)
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
            payload = await capture_go(ws, target_url)
            result = {
                "status": "complete",
                "engine": "brightdata-browser-go",
                "request_id": request_id,
                "input_url": target_url,
                "kind": "category",
                "country": label,
                "checked_at": payload.get("checked_at"),
                "go_response": payload,
            }
            out_path.write_text(
                json.dumps(result, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            print(json.dumps({
                "status": "complete",
                "source": "GO!",
                "store": "GO!",
                "products": len(payload.get("products") or []),
                "country": label,
            }, ensure_ascii=False))
            return 0
        except Exception as exc:
            errors.append({"country": label, "error": str(exc)[:900]})

    print(json.dumps({
        "go_capture_errors": errors,
    }, ensure_ascii=False))
    out_path.write_text(
        json.dumps({
            "status": "error",
            "error": "go_capture_failed",
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
