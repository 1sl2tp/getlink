#!/usr/bin/env python3
import asyncio
import json
import os
import re
import sys
from urllib.parse import quote, unquote, urlparse, urlunparse

from playwright.async_api import async_playwright

TARGET="https://www.vinamilk.com.vn/collections/sua-tuoi?src=ALL"
GRAPHQL="open-p04-vn.vinamilk.com.vn/api/graphql-pub/"
KEYWORDS=("x-signature","x-graphql-hash","x-timestamp","graphql-hash")
BLOCK_TYPES={"image","media","font"}


def clean(v):
    return re.sub(r"\s+"," ",str(v or "")).strip()


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
        if value:return value
    username=clean(os.environ.get("BRIGHTDATA_BROWSER_USERNAME"))
    password=clean(os.environ.get("BRIGHTDATA_BROWSER_PASSWORD"))
    if not username or not password:
        raise RuntimeError("brightdata_credentials_missing")
    return "wss://"+quote(username,safe="")+":"+quote(password,safe="")+"@brd.superproxy.io:9222"


def snippet(text,pos,radius=650):
    start=max(0,pos-radius)
    end=min(len(text),pos+radius)
    return text[start:end].replace("\n"," ")[:1400]


async def main():
    country=clean(os.environ.get("BRIGHTDATA_COUNTRY") or "vn").lower()
    ws=rewrite_ws_country(base_ws_from_env(),country)
    graphql=[]
    js_hits=[]
    seen_js=set()

    async with async_playwright() as pw:
        browser=await pw.chromium.connect_over_cdp(ws,timeout=60000)
        try:
            page=await browser.new_page()

            async def route_handler(route):
                if route.request.resource_type in BLOCK_TYPES:
                    await route.abort(); return
                await route.continue_()
            await page.route("**/*",route_handler)

            async def on_request(request):
                if GRAPHQL not in request.url:
                    return
                try:
                    headers={k.lower():v for k,v in (await request.all_headers()).items()}
                    body=request.post_data or ""
                    op=""
                    try:op=(json.loads(body or "{}") or {}).get("operationName") or ""
                    except Exception:pass
                    picked={k:headers.get(k,"") for k in (
                        "client-id","x-external-code","x-graphql-hash","x-signature",
                        "x-terminal","x-timestamp","x-trace-group"
                    )}
                    graphql.append({"operation":op,"headers":picked,"body":body})
                    print("VNM_SIGNED_REQUEST",json.dumps({
                        "operation":op,
                        "headers":picked,
                        "body_length":len(body),
                    },ensure_ascii=False))
                except Exception as exc:
                    print("VNM_SIGNED_REQUEST_WARN",type(exc).__name__,str(exc)[:300],file=sys.stderr)

            async def on_response(response):
                try:
                    url=response.url
                    ctype=(response.headers.get("content-type") or "").lower()
                    is_js=("javascript" in ctype or url.split("?")[0].endswith(".js"))
                    if not is_js or url in seen_js:
                        return
                    seen_js.add(url)
                    body=await response.text()
                    low=body.lower()
                    for keyword in KEYWORDS:
                        pos=low.find(keyword)
                        if pos>=0:
                            row={"url":url,"keyword":keyword,"snippet":snippet(body,pos)}
                            js_hits.append(row)
                            print("VNM_SIGNATURE_JS",json.dumps(row,ensure_ascii=False))
                except Exception:
                    pass

            page.on("request",lambda r:asyncio.create_task(on_request(r)))
            page.on("response",lambda r:asyncio.create_task(on_response(r)))

            await page.goto(TARGET,wait_until="domcontentloaded",timeout=120000)
            await page.wait_for_timeout(12000)
            try:
                for _ in range(4):
                    await page.mouse.wheel(0,1700)
                    await page.wait_for_timeout(1000)
            except Exception:
                pass
            await page.wait_for_timeout(5000)

            print("VNM_SIGNATURE_SUMMARY",json.dumps({
                "graphql_requests":len(graphql),
                "js_hits":len(js_hits),
                "operations":[x["operation"] for x in graphql],
            },ensure_ascii=False))
        finally:
            await browser.close()

    # Diagnostic succeeds when the browser generated at least one signed GraphQL call.
    signed=[x for x in graphql if x["headers"].get("x-signature")]
    if not signed:
        print("VNM_SIGNATURE_FAIL no signed GraphQL request",file=sys.stderr)
        return 1
    return 0


if __name__=="__main__":
    raise SystemExit(asyncio.run(main()))
