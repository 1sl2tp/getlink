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
        """(anchors, categoryLabel) => {
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


async def capture_go(ws_url: str, target_url: str) -> dict:
    async with async_playwright() as pw:
        browser = await pw.chromium.connect_over_cdp(ws_url, timeout=60000)
        try:
            page = await browser.new_page()
            await page.route("**/*", route_handler)
            await prepare_go_page(page, target_url)

            category_label = category_name_from_url(target_url)
            products = {}
            stable = 0
            previous_count = -1
            previous_height = -1

            for _ in range(28):
                for row in await extract_products(page, category_label):
                    products[row["url"]] = row

                try:
                    height = await page.evaluate(
                        "() => Math.max(document.body ? document.body.scrollHeight : 0, document.documentElement ? document.documentElement.scrollHeight : 0)"
                    )
                    await page.evaluate(
                        "() => window.scrollTo(0, Math.max(document.body.scrollHeight, document.documentElement.scrollHeight))"
                    )
                except Exception:
                    height = previous_height
                await page.wait_for_timeout(900)

                count = len(products)
                if count == previous_count and height == previous_height:
                    stable += 1
                else:
                    stable = 0
                previous_count = count
                previous_height = height
                if stable >= 4:
                    break

            if not products:
                raise RuntimeError("go_no_products_captured")

            return {
                "category_name": category_label,
                "store_name": "",
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
