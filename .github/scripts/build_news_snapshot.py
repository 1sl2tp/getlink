#!/usr/bin/env python3
from __future__ import annotations
import argparse, concurrent.futures, datetime as dt, html, json, pathlib, re, time, unicodedata, urllib.parse, urllib.request
import feedparser

try:
    from googlenewsdecoder import gnewsdecoder
except Exception:
    gnewsdecoder=None

try:
    from ftfy import fix_text as ftfy_fix_text
except Exception:
    ftfy_fix_text=None

DEFAULT_LIMIT=100
DETAIL_LIMIT=24
RICH_IMAGE_LIMIT=100
RICH_CONTENT_LIMIT=24
RICH_WORKERS=12
FEED_TIMEOUT=10
DETAIL_TIMEOUT=6
GOOGLE_HOT_QUERIES=[
 "Tin nóng",
 "Tin hot",
 "Tăng giá",
 "Chiến tranh",
 "công an",
 "xét xử",
 "vĩ mô",
 "bãi nhiệm",
 "cách chức",
 "bổ nhiệm",
 "tạm giam",
 "khởi tố",
 "khám xét",
 "tổng thống",
 "lãi",
 "thuế",
 "thủ tướng",
 "chứng khoán",
 "chủ tịch",
 "tỷ phú",
 "lừa đảo",
]
STOP={"va","cua","cho","voi","tai","tu","den","trong","tren","sau","truoc","khi","la","mot","nhung","cac","co","duoc","se","da","dang","ve","noi","theo","nay","hom","ngay","moi","nhat","vi","o"}

def http_get(url,timeout,accept="*/*"):
    req=urllib.request.Request(url,headers={
      "Accept":accept,
      "User-Agent":"Mozilla/5.0 (compatible; GETLINK-News-Snapshot/2.0; +https://get.taphoa.xyz)",
      "Cache-Control":"no-cache",
    })
    with urllib.request.urlopen(req,timeout=timeout) as res:
        return res.read(),res.geturl()

def google_query_feed(query):
    q=urllib.parse.quote(f'"{query}" when:1d')
    return f"https://news.google.com/rss/search?q={q}&hl=vi&gl=VN&ceid=VN:vi"

def google_top_feed():
    return "https://news.google.com/rss?hl=vi&gl=VN&ceid=VN:vi"

def clean_text(v):
    value=html.unescape(str(v or ""))
    if ftfy_fix_text is not None:
        try:value=ftfy_fix_text(value)
        except Exception:pass
    return unicodedata.normalize("NFC",value).replace("\ufffd","").strip()

def plain(v):
    return re.sub(r"\s+"," ",clean_text(re.sub(r"<[^>]+>"," ",str(v or "")))).strip()

def norm(v):
    s=unicodedata.normalize("NFD",str(v or "").lower())
    s="".join(ch for ch in s if unicodedata.category(ch)!="Mn").replace("đ","d")
    return re.sub(r"[^a-z0-9]+"," ",s).strip()

def tokens(v):
    return {x for x in norm(v).split() if len(x)>1 and x not in STOP and not x.isdigit()}

def sim(a,b):
    aa,bb=tokens(a),tokens(b)
    if not aa or not bb:return (0,0,0)
    common=len(aa&bb)
    return common,common/max(1,len(aa|bb)),common/max(1,min(len(aa),len(bb)))

def parse_time(entry):
    p=entry.get("published_parsed") or entry.get("updated_parsed")
    if p:return dt.datetime.fromtimestamp(time.mktime(p),dt.timezone.utc)
    raw=str(entry.get("published") or entry.get("updated") or "")
    try:
        d=dt.datetime.fromisoformat(raw.replace("Z","+00:00"))
        return (d if d.tzinfo else d.replace(tzinfo=dt.timezone.utc)).astimezone(dt.timezone.utc)
    except:return dt.datetime.fromtimestamp(0,dt.timezone.utc)

def entry_images(entry):
    out=[]
    def add(v):
        u=str(v or "").strip()
        if u.startswith(("http://","https://")) and u not in out:out.append(u)
    for key in ("media_content","media_thumbnail"):
        for item in entry.get(key) or []:
            if isinstance(item,dict):add(item.get("url"))
    for item in entry.get("enclosures") or []:
        if isinstance(item,dict):add(item.get("href") or item.get("url"))
    raw=str(entry.get("summary") or entry.get("description") or "")
    for m in re.finditer(r'<img\b[^>]*\bsrc=["\']([^"\']+)["\']',raw,re.I):add(html.unescape(m.group(1)))
    return out[:8]

def fetch_google_query(query):
    feed_url=google_top_feed() if query=="__top__" else google_query_feed(query)
    try:
        body,_=http_get(feed_url,FEED_TIMEOUT,"application/rss+xml, application/xml, text/xml, */*;q=0.8")
        feed=feedparser.parse(body); rows=[]
        for e in list(feed.entries)[:30]:
            source=e.get("source") or {}
            source_name=plain(source.get("title") if isinstance(source,dict) else "") or "Google News"
            source_href=str(source.get("href") if isinstance(source,dict) else "").strip()
            title=plain(e.get("title"))
            suffix=" - "+source_name
            if source_name and title.lower().endswith(suffix.lower()):
                title=title[:-len(suffix)].strip()
            url=str(e.get("link") or "").strip()
            if not title or not url:continue
            summary_raw=e.get("summary") or e.get("description") or ""
            summary=plain(summary_raw)[:650]
            content=""
            parts=e.get("content") or []
            if parts and isinstance(parts[0],dict):content=plain(parts[0].get("value"))[:6000]
            images=entry_images(e); published=parse_time(e)
            source_key=norm(source_name).replace(" ","-")[:48] or "google-news"
            rows.append({
              "id":f"google:{source_key}:{norm(title)[:96]}:{published.timestamp():.0f}",
              "title":title,"summary":summary,"content":content,"url":url,
              "image":images[0] if images else "","images":images,
              "published_at":published.isoformat().replace("+00:00","Z"),
              "source_key":source_key,"source_name":source_name,
              "source_home":source_href,
              "google_query":"top" if query=="__top__" else query,
              "duplicate_count":1,"also_sources":[]
            })
        return rows
    except Exception as exc:
        print("WARN google",query,str(exc)[:160])
        return []

def near(a,b):
    if norm(a.get("title"))==norm(b.get("title")) and norm(a.get("title")):return True
    c,j,o=sim(a.get("title"),b.get("title"))
    if c>=4 and (o>=.72 or j>=.58):return True
    c,j,o=sim(str(a.get("content") or a.get("summary") or "")[:1600],str(b.get("content") or b.get("summary") or "")[:1600])
    return c>=10 and (o>=.76 or j>=.64)

def quality(x):
    return len(x.get("images") or [])*100000+min(50000,len(str(x.get("content") or ""))*8)+min(5000,len(str(x.get("summary") or "")))

def merge(a,b):
    p,o=(b,a) if quality(b)>quality(a) else (a,b)
    images=[]
    for u in [*(p.get("images") or []),*(o.get("images") or [])]:
        if u and u not in images:images.append(u)
    out=dict(p); out["images"]=images[:8]; out["image"]=images[0] if images else (p.get("image") or o.get("image") or "")
    out["content"]=p.get("content") or o.get("content") or ""; out["summary"]=p.get("summary") or o.get("summary") or ""
    out["duplicate_count"]=int(a.get("duplicate_count") or 1)+int(b.get("duplicate_count") or 1)
    out["also_sources"]=[]; return out

def dedupe(items):
    out=[]
    for item in sorted(items,key=lambda x:x.get("published_at") or "",reverse=True):
        idx=next((i for i,x in enumerate(out) if near(x,item)),-1)
        if idx<0:out.append(item)
        else:out[idx]=merge(out[idx],item)
    return out

def is_noise_item(item):
    title=norm(item.get("title"))
    if len(title)<12:return True
    if re.match(r"^tin [a-z0-9 ]+ tin tuc\b",title):return True
    if title in {"tin moi","tin nong","tin hot","tin tuc","the thao","kinh doanh","giai tri"}:return True
    raw=str(item.get("url") or "")
    if "news.google.com/" not in raw:
        try:
            u=urllib.parse.urlparse(raw)
            path=(u.path or "").lower()
            query=(u.query or "").lower()
            if "/tag/" in path or "/tags/" in path or "page=" in query:return True
        except Exception:pass
    return False

def process_items(items):
    return [x for x in dedupe(items) if not is_noise_item(x)]

def meta_images(text,base):
    out=[]
    for tag in re.findall(r"<meta\b[^>]*>",text,re.I):
        km=re.search(r'\b(?:property|name|itemprop)=["\']([^"\']+)["\']',tag,re.I)
        cm=re.search(r'\bcontent=["\']([^"\']+)["\']',tag,re.I)
        key=km.group(1).lower() if km else ""
        if key not in {"og:image","og:image:url","twitter:image","twitter:image:src","image","thumbnailurl"} or not cm:continue
        u=urllib.parse.urljoin(base,html.unescape(cm.group(1)))
        if u.startswith(("http://","https://")) and u not in out:out.append(u)
    for tag in re.findall(r"<link\b[^>]*>",text,re.I):
        if not re.search(r'\brel=["\'][^"\']*(?:image_src|preload)[^"\']*["\']',tag,re.I):continue
        hm=re.search(r'\bhref=["\']([^"\']+)["\']',tag,re.I)
        if not hm:continue
        u=urllib.parse.urljoin(base,html.unescape(hm.group(1)))
        if u.startswith(("http://","https://")) and u not in out:out.append(u)
    return out

def page_images(text,base):
    article=re.search(r"<article\b[^>]*>([\s\S]*?)</article>",text,re.I)
    scope=article.group(1) if article else text[:350000]
    out=[]
    bad=("logo","icon","avatar","sprite","favicon","tracking","pixel","banner","ads","advert")
    def add(raw):
        value=html.unescape(str(raw or "").strip())
        if not value:return
        if "," in value and " " in value:
            value=value.split(",")[-1].strip().split()[0]
        u=urllib.parse.urljoin(base,value)
        low=u.lower()
        if not u.startswith(("http://","https://")):return
        if any(x in low for x in bad) or low.endswith((".svg",".ico")):return
        if u not in out:out.append(u)
    for tag in re.findall(r"<img\b[^>]*>",scope,re.I):
        for attr in ("src","data-src","data-original","data-lazy-src","srcset"):
            m=re.search(r'\b'+re.escape(attr)+r'=["\']([^"\']+)["\']',tag,re.I)
            if m:add(m.group(1))
        if len(out)>=8:break
    return out[:8]

def jsonld(text):
    body=""; images=[]
    def walk(v):
        nonlocal body
        if isinstance(v,list):
            for x in v:walk(x)
        elif isinstance(v,dict):
            if not body and isinstance(v.get("articleBody"),str):body=plain(v["articleBody"])
            img=v.get("image"); vals=img if isinstance(img,list) else [img]
            for x in vals:
                u=x if isinstance(x,str) else (x.get("url") if isinstance(x,dict) else "")
                if isinstance(u,str) and u.startswith(("http://","https://")) and u not in images:images.append(u)
            if isinstance(v.get("@graph"),list):walk(v["@graph"])
    for m in re.finditer(r'<script\b[^>]*type=["\']application/ld\+json["\'][^>]*>([\s\S]*?)</script>',text,re.I):
        try:walk(json.loads(html.unescape(m.group(1))))
        except:pass
    return body,images

def article_text(text):
    m=re.search(r"<article\b[^>]*>([\s\S]*?)</article>",text,re.I); scope=m.group(1) if m else text; out=[]
    for p in re.finditer(r"<p\b[^>]*>([\s\S]*?)</p>",scope,re.I):
        t=plain(p.group(1))
        if len(t)>=35 and t not in out:out.append(t)
        if sum(map(len,out))>10000:break
    return "\n\n".join(out)

def decode_google_url(url):
    value=str(url or "").strip()
    if not value or "news.google.com/" not in value or gnewsdecoder is None:
        return value
    try:
        decoded=gnewsdecoder(value,interval=0)
        if isinstance(decoded,dict) and decoded.get("status") and decoded.get("decoded_url"):
            out=str(decoded["decoded_url"]).strip()
            if out.startswith(("http://","https://")):
                return out
    except Exception as exc:
        print("WARN decode",str(exc)[:120])
    return value

def enrich_article(item,include_content=True):
    original=str(item.get("url") or "").strip()
    target=decode_google_url(original)
    try:
        body,final=http_get(target,DETAIL_TIMEOUT,"text/html,application/xhtml+xml;q=0.9,*/*;q=0.8")
        text=body.decode("utf-8",errors="ignore")
    except:return item
    jb,ji=jsonld(text); images=[]
    for u in [*ji,*meta_images(text,final),*page_images(text,final),*(item.get("images") or [])]:
        if u and u not in images:images.append(u)
    out=dict(item)
    if images:out["images"]=images[:8];out["image"]=images[0]
    if include_content:
        detail=jb or article_text(text)
        if len(detail)>len(str(out.get("content") or "")):out["content"]=detail[:10000]
    if final and "news.google.com/" not in final:
        out["url"]=final
    elif target and "news.google.com/" not in target:
        out["url"]=target
    return out

def iso(v):
    try:
        d=dt.datetime.fromisoformat(str(v or "").replace("Z","+00:00"))
        return (d if d.tzinfo else d.replace(tzinfo=dt.timezone.utc)).astimezone(dt.timezone.utc)
    except:return dt.datetime.fromtimestamp(0,dt.timezone.utc)

def hot_score(item,now):
    age=max(0,(now-iso(item.get("published_at"))).total_seconds()/60)
    return round(max(0,480-age)+min(6,max(1,int(item.get("duplicate_count") or 1)))*36+min(4,len(item.get("images") or []))*8+min(24,len(str(item.get("content") or ""))/180),3)

def compact(item,now):
    images=[]
    for u in item.get("images") or []:
        if u and u not in images:images.append(u)
    return {
      "id":str(item.get("id") or ""),"title":str(item.get("title") or "").strip(),"summary":str(item.get("summary") or "")[:420],
      "content":"","url":str(item.get("url") or ""),"image":images[0] if images else str(item.get("image") or ""),
      "images":images[:3],"published_at":str(item.get("published_at") or ""),"source_key":str(item.get("source_key") or ""),
      "source_name":str(item.get("source_name") or ""),"topic":"latest","duplicate_count":max(1,int(item.get("duplicate_count") or 1)),
      "also_sources":[],"hot_score":hot_score(item,now)
    }

def build_snapshot(limit=DEFAULT_LIMIT):
    # Fast discovery only. Do not scrape article pages here: the workflow
    # publishes this snapshot first so users see new Google News items quickly.
    google_queries=["__top__",*GOOGLE_HOT_QUERIES]
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        google_batches=list(pool.map(fetch_google_query,google_queries))
    items=process_items([x for batch in google_batches for x in batch]);now=dt.datetime.now(dt.timezone.utc)
    items.sort(key=lambda x:(hot_score(x,now),x.get("published_at") or ""),reverse=True)
    rows=[compact(x,now) for x in items[:limit] if x.get("title") and x.get("url")]
    newest=max((iso(x.get("published_at")) for x in rows),default=now)
    return {"version":4,"generated_at":now.isoformat().replace("+00:00","Z"),"newest_published_at":newest.isoformat().replace("+00:00","Z"),
      "newest_age_seconds":max(0,int((now-newest).total_seconds())),"strategy":"google-news-rss-only-snapshot",
      "phase":"fast","storage":"git-ephemeral-branch","database":False,"query_count":len(google_queries),"items":rows}

def enrich_snapshot(input_path,output_path,limit=DEFAULT_LIMIT):
    data=json.loads(pathlib.Path(input_path).read_text(encoding="utf-8"))
    items=list(data.get("items") or [])[:limit]
    candidates=[
      (x,i<RICH_CONTENT_LIMIT)
      for i,x in enumerate(items[:RICH_IMAGE_LIMIT])
      if not (x.get("image") or x.get("images")) or (i<RICH_CONTENT_LIMIT and len(str(x.get("content") or ""))<450)
    ]
    if candidates:
        pos={str(x.get("id") or ""):i for i,x in enumerate(items)}
        with concurrent.futures.ThreadPoolExecutor(max_workers=RICH_WORKERS) as pool:
            jobs={pool.submit(enrich_article,x,include_content):str(x.get("id") or "") for x,include_content in candidates}
            for future in concurrent.futures.as_completed(jobs):
                try:enriched=future.result()
                except Exception as exc:
                    print("WARN enrich",str(exc)[:120]);continue
                i=pos.get(jobs[future])
                if i is not None:items[i]=enriched
    now=dt.datetime.now(dt.timezone.utc)
    items=process_items(items)
    items.sort(key=lambda x:(hot_score(x,now),x.get("published_at") or ""),reverse=True)
    data["items"]=[compact(x,now) for x in items[:limit] if x.get("title") and x.get("url")]
    data["phase"]="rich"
    data["enriched_at"]=now.isoformat().replace("+00:00","Z")
    data["image_count"]=sum(1 for x in data["items"] if x.get("image"))
    data["multi_image_count"]=sum(1 for x in data["items"] if len(x.get("images") or [])>=2)
    pathlib.Path(output_path).write_text(json.dumps(data,ensure_ascii=False,separators=(",",":"))+"\n",encoding="utf-8")
    print("GETLINK rich-news snapshot",f"items={len(data['items'])}",f"images={data['image_count']}",f"multi={data['multi_image_count']}")

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--output",required=True)
    p.add_argument("--input")
    p.add_argument("--enrich-only",action="store_true")
    p.add_argument("--limit",type=int,default=DEFAULT_LIMIT)
    a=p.parse_args()
    limit=max(20,min(100,a.limit))
    if a.enrich_only:
        if not a.input:raise SystemExit("--input is required with --enrich-only")
        enrich_snapshot(a.input,a.output,limit)
        return
    snap=build_snapshot(limit)
    if not snap["items"]:raise SystemExit("No news items fetched; keep previous snapshot")
    out=pathlib.Path(a.output);out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps(snap,ensure_ascii=False,separators=(",",":"))+"\n",encoding="utf-8")
    print("GETLINK hot-news snapshot",f"items={len(snap['items'])}",f"newest_age_seconds={snap['newest_age_seconds']}",f"phase={snap['phase']}")

if __name__=="__main__":main()
