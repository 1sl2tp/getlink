#!/usr/bin/env python3
from __future__ import annotations
import argparse, concurrent.futures, datetime as dt, html, json, pathlib, re, time, unicodedata, urllib.parse, urllib.request
import feedparser

DEFAULT_LIMIT=100
DETAIL_LIMIT=24
FEED_TIMEOUT=10
DETAIL_TIMEOUT=10
SOURCES=[
 {"key":"vnexpress","name":"VnExpress","domain":"vnexpress.net","feed":"https://vnexpress.net/rss/tin-moi-nhat.rss"},
 {"key":"dantri","name":"Dân Trí","domain":"dantri.com.vn","feed":"https://dantri.com.vn/rss/home.rss"},
 {"key":"tuoitre","name":"Tuổi Trẻ","domain":"tuoitre.vn","feed":"https://tuoitre.vn/home.rss"},
 {"key":"baomoi","name":"Báo Mới","domain":"baomoi.com","feed":""},
 {"key":"vietnamnet","name":"VietnamNet","domain":"vietnamnet.vn","feed":""},
 {"key":"kenh14","name":"Kênh14","domain":"kenh14.vn","feed":"https://kenh14.vn/rss/home.rss"},
 {"key":"zing","name":"Zing News","domain":"znews.vn","feed":""},
 {"key":"thanhnien","name":"Báo Thanh Niên","domain":"thanhnien.vn","feed":"https://thanhnien.vn/rss/home.rss"},
 {"key":"laodong","name":"Lao Động","domain":"laodong.vn","feed":""},
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

def google_feed(domain):
    q=urllib.parse.quote(f"site:{domain} when:2d")
    return f"https://news.google.com/rss/search?q={q}&hl=vi&gl=VN&ceid=VN:vi"

def plain(v):
    return re.sub(r"\s+"," ",html.unescape(re.sub(r"<[^>]+>"," ",str(v or "")))).strip()

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

def fetch_source(source):
    candidates=[source.get("feed") or "",google_feed(source["domain"])]
    for feed_url in [x for i,x in enumerate(candidates) if x and x not in candidates[:i]]:
        try:
            body,_=http_get(feed_url,FEED_TIMEOUT,"application/rss+xml, application/xml, text/xml, */*;q=0.8")
            feed=feedparser.parse(body); rows=[]
            for e in list(feed.entries)[:40]:
                title=plain(e.get("title"))
                suffix=" - "+source["name"]
                if title.lower().endswith(suffix.lower()):title=title[:-len(suffix)].strip()
                url=str(e.get("link") or "").strip()
                if not title or not url:continue
                summary=plain(e.get("summary") or e.get("description") or "")[:650]
                content=""
                parts=e.get("content") or []
                if parts and isinstance(parts[0],dict):content=plain(parts[0].get("value"))[:6000]
                images=entry_images(e); published=parse_time(e)
                rows.append({
                  "id":f"{source['key']}:{norm(title)[:96]}:{published.timestamp():.0f}",
                  "title":title,"summary":summary,"content":content,"url":url,
                  "image":images[0] if images else "","images":images,
                  "published_at":published.isoformat().replace("+00:00","Z"),
                  "source_key":source["key"],"source_name":source["name"],
                  "duplicate_count":1,"also_sources":[]
                })
            if rows:return rows
        except Exception as exc:
            print("WARN",source["key"],feed_url,str(exc)[:160])
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

def meta_images(text,base):
    out=[]
    for tag in re.findall(r"<meta\b[^>]*>",text,re.I):
        km=re.search(r'\b(?:property|name)=["\']([^"\']+)["\']',tag,re.I)
        cm=re.search(r'\bcontent=["\']([^"\']+)["\']',tag,re.I)
        key=km.group(1).lower() if km else ""
        if key not in {"og:image","og:image:url","twitter:image","twitter:image:src"} or not cm:continue
        u=urllib.parse.urljoin(base,html.unescape(cm.group(1)))
        if u.startswith(("http://","https://")) and u not in out:out.append(u)
    return out

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

def enrich_article(item):
    try:
        body,final=http_get(str(item.get("url") or ""),DETAIL_TIMEOUT,"text/html,application/xhtml+xml;q=0.9,*/*;q=0.8")
        text=body.decode("utf-8",errors="ignore")
    except:return item
    jb,ji=jsonld(text); images=[]
    for u in [*ji,*meta_images(text,final),*(item.get("images") or [])]:
        if u and u not in images:images.append(u)
    out=dict(item)
    if images:out["images"]=images[:8];out["image"]=images[0]
    detail=jb or article_text(text)
    if len(detail)>len(str(out.get("content") or "")):out["content"]=detail[:10000]
    out["url"]=final;return out

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
      "id":str(item.get("id") or ""),"title":str(item.get("title") or "").strip(),"summary":str(item.get("summary") or "")[:600],
      "content":str(item.get("content") or "")[:10000],"url":str(item.get("url") or ""),"image":images[0] if images else str(item.get("image") or ""),
      "images":images[:8],"published_at":str(item.get("published_at") or ""),"source_key":str(item.get("source_key") or ""),
      "source_name":str(item.get("source_name") or ""),"topic":"latest","duplicate_count":max(1,int(item.get("duplicate_count") or 1)),
      "also_sources":[],"hot_score":hot_score(item,now)
    }

def build_snapshot(limit=DEFAULT_LIMIT):
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(SOURCES)) as pool:batches=list(pool.map(fetch_source,SOURCES))
    items=dedupe([x for batch in batches for x in batch]);now=dt.datetime.now(dt.timezone.utc)
    items.sort(key=lambda x:(hot_score(x,now),x.get("published_at") or ""),reverse=True)
    candidates=[x for x in items[:DETAIL_LIMIT] if not x.get("images") or len(str(x.get("content") or ""))<450]
    if candidates:
        pos={str(x.get("id") or ""):i for i,x in enumerate(items)}
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            jobs={pool.submit(enrich_article,x):str(x.get("id") or "") for x in candidates}
            for future in concurrent.futures.as_completed(jobs):
                try:enriched=future.result()
                except:continue
                i=pos.get(jobs[future])
                if i is not None:items[i]=enriched
    items.sort(key=lambda x:(hot_score(x,now),x.get("published_at") or ""),reverse=True)
    rows=[compact(x,now) for x in items[:limit] if x.get("title") and x.get("url")]
    newest=max((iso(x.get("published_at")) for x in rows),default=now)
    return {"version":2,"generated_at":now.isoformat().replace("+00:00","Z"),"newest_published_at":newest.isoformat().replace("+00:00","Z"),
      "newest_age_seconds":max(0,int((now-newest).total_seconds())),"strategy":"direct-rss-background-hot-snapshot",
      "storage":"git-ephemeral-branch","database":False,"source_count":len(SOURCES),"items":rows}

def main():
    p=argparse.ArgumentParser();p.add_argument("--output",required=True);p.add_argument("--limit",type=int,default=DEFAULT_LIMIT);a=p.parse_args()
    snap=build_snapshot(max(20,min(100,a.limit)))
    if not snap["items"]:raise SystemExit("No news items fetched; keep previous snapshot")
    out=pathlib.Path(a.output);out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps(snap,ensure_ascii=False,separators=(",",":"))+"\n",encoding="utf-8")
    print("GETLINK hot-news snapshot",f"items={len(snap['items'])}",f"newest_age_seconds={snap['newest_age_seconds']}")

if __name__=="__main__":main()
