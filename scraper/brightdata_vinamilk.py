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

VNM_HOSTS={"vinamilk.com.vn","www.vinamilk.com.vn"}
GRAPHQL_URL="https://open-p04-vn.vinamilk.com.vn/api/graphql-pub/"
BLOCK_TYPES={"image","media","font"}
USEFUL_OPS={"GetNavigationMaster","GetEShopProductShelf","GetEShopProductSelectors"}

def clean(v):
    return re.sub(r"\s+"," ",str(v or "")).strip()

def canonical_vnm(raw):
    u=urlparse(clean(raw))
    if (u.hostname or "").lower() not in VNM_HOSTS:
        raise ValueError("invalid_vinamilk_url")
    path=re.sub(r"/+","/",u.path or "/").rstrip("/") or "/"
    return urlunparse(("https","www.vinamilk.com.vn",path,"",u.query,""))

def normalize_username_country(username,country):
    username=re.sub(r"-country-[a-zA-Z]{2}(?=-|$)","",username)
    country=clean(country).lower()
    return f"{username}-country-{country}" if country else username

def rewrite_ws_country(ws_url,country):
    p=urlparse(ws_url)
    if p.scheme not in {"ws","wss"}:
        raise ValueError("brightdata_ws_invalid")
    username=unquote(p.username or "")
    password=unquote(p.password or "")
    if not username or not password:
        raise ValueError("brightdata_ws_credentials_missing")
    username=normalize_username_country(username,country)
    host=p.hostname or "brd.superproxy.io"
    port=p.port or 9222
    netloc=f"{quote(username,safe='')}:{quote(password,safe='')}@{host}:{port}"
    return urlunparse((p.scheme,netloc,p.path or "","","",""))

def base_ws_from_env():
    for name in ("BRIGHTDATA_BROWSER_WS","BRIGHTDATA_BROWSER_WSS","SBR_WS_CDP","SBR_CDP_URL"):
        value=clean(os.environ.get(name))
        if value:
            print("Using Bright Data endpoint from",name)
            return value
    username=clean(os.environ.get("BRIGHTDATA_BROWSER_USERNAME"))
    password=clean(os.environ.get("BRIGHTDATA_BROWSER_PASSWORD"))
    if not username or not password:
        raise RuntimeError(
            "brightdata_credentials_missing: set BRIGHTDATA_BROWSER_WS "
            "or BRIGHTDATA_BROWSER_USERNAME/BRIGHTDATA_BROWSER_PASSWORD"
        )
    print("Using Bright Data endpoint from username/password")
    return "wss://"+quote(username,safe="")+":"+quote(password,safe="")+"@brd.superproxy.io:9222"

def country_candidates():
    preferred=clean(os.environ.get("BRIGHTDATA_COUNTRY") or "vn").lower()
    out=[]
    for value in (preferred,"sg",""):
        if value not in out:
            out.append(value)
    return out

async def capture(ws_url,target_url):
    records=[]
    async with async_playwright() as pw:
        browser=await pw.chromium.connect_over_cdp(ws_url,timeout=60000)
        try:
            page=await browser.new_page()

            async def route_handler(route):
                if route.request.resource_type in BLOCK_TYPES:
                    await route.abort()
                    return
                await route.continue_()

            await page.route("**/*",route_handler)

            async def inspect_response(response):
                if "open-p04-vn.vinamilk.com.vn/api/graphql-pub/" not in response.url:
                    return
                try:
                    post=response.request.post_data or ""
                    req={}
                    try:
                        req=json.loads(post or "{}")
                    except Exception:
                        pass
                    op=clean(req.get("operationName"))
                    body_text=await response.text()
                    body=None
                    try:
                        body=json.loads(body_text)
                    except Exception:
                        body={"_raw":body_text[:20000]}
                    row={
                        "status":response.status,
                        "operation":op,
                        "variables":req.get("variables") or {},
                        "response":body,
                    }
                    records.append(row)
                    print("VNM_BRIGHTDATA_GQL",json.dumps({
                        "status":response.status,
                        "operation":op,
                        "bytes":len(body_text),
                    },ensure_ascii=False))
                except Exception as exc:
                    print("VNM_BRIGHTDATA_CAPTURE_WARN",type(exc).__name__,str(exc)[:300],file=sys.stderr)

            page.on("response",lambda r:asyncio.create_task(inspect_response(r)))

            nav_error=None
            try:
                await page.goto(target_url,wait_until="domcontentloaded",timeout=120000)
            except Exception as exc:
                nav_error=exc

            await page.wait_for_timeout(10000)
            try:
                for _ in range(5):
                    await page.mouse.wheel(0,1600)
                    await page.wait_for_timeout(900)
            except Exception:
                pass
            await page.wait_for_timeout(5000)

            title=""
            try:
                title=await page.title()
            except Exception:
                pass
            print("VNM_BRIGHTDATA_PAGE",json.dumps({
                "url":page.url,
                "title":title,
                "graphql_count":len(records),
                "navigation_error":str(nav_error)[:300] if nav_error else "",
            },ensure_ascii=False))
            return records
        finally:
            await browser.close()

def useful(records):
    out=[]
    for row in records:
        op=clean(row.get("operation"))
        body=row.get("response")
        text=json.dumps(body,ensure_ascii=False) if body is not None else ""
        if row.get("status")==200 and (
            op in USEFUL_OPS
            or ("variantId" in text and ("price" in text or "packagingValue" in text))
        ):
            out.append(row)
    return out

async def run(args):
    target=canonical_vnm(args.url)
    out_path=Path(args.output or "data/vinamilk-brightdata-probe.json")
    out_path.parent.mkdir(parents=True,exist_ok=True)

    try:
        base_ws=base_ws_from_env()
    except Exception as exc:
        out_path.write_text(json.dumps({
            "status":"error",
            "error":"brightdata_credentials_missing",
            "detail":str(exc),
        },ensure_ascii=False,indent=2),encoding="utf-8")
        print("VNM_BRIGHTDATA_FAIL",str(exc),file=sys.stderr)
        return 2

    errors=[]
    for country in country_candidates():
        label=country or "auto"
        try:
            records=await capture(rewrite_ws_country(base_ws,country),target)
            good=useful(records)
            if not good:
                raise RuntimeError("vinamilk_graphql_not_captured")
            out_path.write_text(json.dumps({
                "status":"complete",
                "engine":"brightdata-browser-api",
                "input_url":target,
                "country":label,
                "operations":[
                    {
                        "status":x.get("status"),
                        "operation":x.get("operation"),
                        "variables":x.get("variables"),
                        "response":x.get("response"),
                    } for x in good
                ],
            },ensure_ascii=False,indent=2),encoding="utf-8")
            print("VNM_BRIGHTDATA_OK",json.dumps({
                "country":label,
                "operations":[x.get("operation") for x in good],
                "count":len(good),
            },ensure_ascii=False))
            return 0
        except Exception as exc:
            message=f"{label}:{type(exc).__name__}:{str(exc)[:700]}"
            errors.append(message)
            print("VNM_BRIGHTDATA_WARN",message,file=sys.stderr)

    out_path.write_text(json.dumps({
        "status":"error",
        "error":"brightdata_vinamilk_capture_failed",
        "detail":" | ".join(errors)[-2500:],
    },ensure_ascii=False,indent=2),encoding="utf-8")
    return 1

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--url",default="https://www.vinamilk.com.vn/collections/sua-tuoi?src=ALL")
    parser.add_argument("--output",default="")
    args=parser.parse_args()
    raise SystemExit(asyncio.run(run(args)))

if __name__=="__main__":
    main()
