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

try:
    from bs4 import BeautifulSoup, UnicodeDammit
except Exception:
    BeautifulSoup=None
    UnicodeDammit=None

DEFAULT_LIMIT=100
DETAIL_LIMIT=24
DISCOVERY_CANDIDATE_LIMIT=180
RICH_IMAGE_LIMIT=180
RICH_WORKERS=16
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
TOPIC_QUERIES={
 "latest":["__top__",*GOOGLE_HOT_QUERIES],
 "thoi-su":["thời sự","xã hội","chính trị"],
 "kinh-doanh":["kinh doanh","thị trường","tài chính"],
 "cong-nghe":["công nghệ","AI","điện thoại"],
 "the-thao":["thể thao","bóng đá","V-League"],
 "giai-tri":["giải trí","âm nhạc","điện ảnh"],
 "suc-khoe":["sức khỏe","y tế","bệnh viện"],
}
STOP={"va","cua","cho","voi","tai","tu","den","trong","tren","sau","truoc","khi","la","mot","nhung","cac","co","duoc","se","da","dang","ve","noi","theo","nay","hom","ngay","moi","nhat","vi","o"}

def http_get(url,timeout,accept="*/*"):
    req=urllib.request.Request(url,headers={
      "Accept":accept,
      "Accept-Language":"vi-VN,vi;q=0.9,en-US;q=0.7,en;q=0.6",
      "User-Agent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
      "Referer":"https://news.google.com/",
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
    value=str(v or "")
    # RSS titles can arrive with nested HTML entities. Decode repeatedly before
    # fixing mojibake so READY JSON never asks the UI to repair text.
    for _ in range(3):
        decoded=html.unescape(value)
        if decoded==value:break
        value=decoded
    if ftfy_fix_text is not None:
        try:value=ftfy_fix_text(value)
        except Exception:pass
    return unicodedata.normalize("NFC",value).replace("\ufffd","").strip()

def clean_title(v,source_name=""):
    value=plain(v)
    source=plain(source_name)
    if source:
        for sep in (" - "," | "," – "," — "):
            suffix=sep+source
            if value.lower().endswith(suffix.lower()):
                value=value[:-len(suffix)].strip()
                break
    # Remove only explicit packaging/SEO/ad labels; keep real headline words.
    label=r"(?:quảng\s*cáo|qc|pr|advertorial|sponsored|tài\s*trợ|tin\s*tài\s*trợ|bài\s*tài\s*trợ|tin\s*hot|hot|video|ảnh|photo)"
    value=re.sub(rf"^\s*(?:(?:\[|\()?\s*{label}\s*(?:\]|\))?\s*[:|\-–—]\s*)+", "", value, flags=re.I)
    value=re.sub(rf"\s*(?:[:|\-–—]\s*)?(?:\[|\()?\s*{label}\s*(?:\]|\))?\s*$", "", value, flags=re.I)
    value=re.sub(r"\s{2,}"," ",value).strip(" |:-–—")
    return clean_text(value)

def title_is_spam(v):
    value=clean_text(v)
    low=norm(value)
    if not low:return True
    if re.search(r"^(?:quang cao|qc|pr|advertorial|sponsored|tai tro)(?:\b|\s*[:\-])",low):return True
    if re.search(r"\b(?:noi dung duoc tai tro|bai viet duoc tai tro|advertorial|sponsored content)\b",low):return True
    if len(re.findall(r"[!]{2,}|[?]{2,}",value))>=2:return True
    return False

def title_key(v):
    value=clean_title(v)
    return norm(re.sub(r"\b(?:video|anh|photo|tin hot|hot)\b"," ",value,flags=re.I))

def title_is_clean(v):
    value=clean_title(v)
    if len(value)<12 or title_is_spam(value):return False
    low=value.lower()
    if re.search(r"&(?:#\d+|#x[0-9a-f]+|[a-z]{2,12});",low,re.I):return False
    if re.search(r"(?:Ã[\x80-\xbf]|Â[\x80-\xbf]|Ä‘|â€|â€™|â€œ|â€˜|á»|áº|ðŸ|�)",value):return False
    if any(ord(ch)<32 and ch not in "\t\n\r" for ch in value):return False
    return True

def ready_image_url(v):
    value=str(v or "").strip()
    if not value.startswith(("http://","https://")):return ""
    low=value.lower()
    if any(x in low for x in (
      "logo","favicon","sprite","tracking","pixel","placeholder","loading","blank",
      "footer","header-logo","site-logo","brand-logo","chia-se-mxh","share-default",
      "/setting/","/settings/","/template/","/templates/","/themes/images/",
      "default-image","default_image","social-default"
    )):return ""
    if re.search(r"\.(?:svg|ico|woff2?|ttf|otf|css|js|json|pdf|xml)(?:[?#]|$)",low):return ""
    return value

def ready_item(item):
    title=clean_text(item.get("title"))
    url=str(item.get("url") or "").strip()
    images=item.get("images") or []
    image=ready_image_url(item.get("image") or (images[0] if images else ""))
    return bool(title_is_clean(title) and url.startswith(("http://","https://")) and "news.google.com/" not in url and image)

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
            title=clean_title(e.get("title"),source_name)
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
    if title_key(a.get("title"))==title_key(b.get("title")) and title_key(a.get("title")):return True
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
        if key not in {"og:image","og:image:url","og:image:secure_url","twitter:image","twitter:image:src","image","thumbnail","thumbnailurl"} or not cm:continue
        u=urllib.parse.urljoin(base,html.unescape(cm.group(1)))
        if u.startswith(("http://","https://")) and u not in out:out.append(u)
    for tag in re.findall(r"<link\b[^>]*>",text,re.I):
        if not re.search(r'\brel=["\'][^"\']*(?:image_src|preload)[^"\']*["\']',tag,re.I):continue
        hm=re.search(r'\bhref=["\']([^"\']+)["\']',tag,re.I)
        if not hm:continue
        u=urllib.parse.urljoin(base,html.unescape(hm.group(1)))
        if u.startswith(("http://","https://")) and u not in out:out.append(u)
    return out

def article_soup(text):
    if BeautifulSoup is None:return None
    try:soup=BeautifulSoup(text,"html.parser")
    except Exception:return None
    selectors=[
      "article","[itemprop='articleBody']",
      "[class*='article-body']","[class*='article__body']","[class*='article-content']",
      "[class*='detail-content']","[class*='detail__content']","[class*='content-detail']",
      "[class*='post-content']","[class*='entry-content']","[class*='fck_detail']",
      "[class*='singular-content']","[class*='the-article-body']","[class*='news-content']",
      "[class*='content-body']","[id*='article-body']","[id*='article-content']",
      "[id*='detail-content']"
    ]
    seen=set(); candidates=[]
    for selector in selectors:
        try:nodes=soup.select(selector)
        except Exception:nodes=[]
        for node in nodes:
            key=id(node)
            if key not in seen:
                seen.add(key); candidates.append(node)
    if not candidates:return None
    def score(node):
        try:
            text_len=len(plain(node.get_text(" ",strip=True)))
            p_count=len(node.find_all("p"))
            img_count=len(node.find_all("img"))
            link_count=len(node.find_all("a"))
            tag=str(getattr(node,"name","") or "").lower()
            marker=" ".join([
              " ".join(node.get("class") or []) if hasattr(node,"get") else "",
              str(node.get("id") or "") if hasattr(node,"get") else "",
              str(node.get("itemprop") or "") if hasattr(node,"get") else ""
            ]).lower()
            semantic=0
            if "articlebody" in marker:semantic+=9000
            if tag=="article":semantic+=7000
            if re.search(r"article[-_ ]?(body|content)|detail[-_ ]?content|content[-_ ]?detail|fck_detail|entry[-_ ]?content|post[-_ ]?content|news[-_ ]?content|content[-_ ]?body",marker):semantic+=6000
            if tag=="main":semantic-=2500
            return semantic+min(30000,text_len)+min(50,p_count)*240+min(20,img_count)*45-min(100,link_count)*14
        except Exception:return 0
    return max(candidates,key=score)

def image_from_tag(tag,base):
    if tag is None:return ""
    target=tag
    name=str(getattr(tag,"name","") or "").lower()
    if name not in ("img","amp-img","source"):
        try:target=tag.find("img") or tag.find("amp-img") or tag.find("source")
        except Exception:target=None
    if target is None:return ""
    try:
        width=int(re.sub(r"\D","",str(target.get("width") or "")) or 0)
        height=int(re.sub(r"\D","",str(target.get("height") or "")) or 0)
    except Exception:width=height=0
    if width and height and max(width,height)<180:return ""
    raw=""
    for attr in ("src","data-src","data-original","data-lazy-src","data-original-src","data-url","data-image","srcset","data-srcset"):
        value=str(target.get(attr) or "").strip()
        if not value:continue
        if "srcset" in attr:
            parts=[x.strip() for x in value.split(",") if x.strip()]
            raw=(parts[-1].split()[0] if parts else "")
        else:raw=value
        if raw:break
    if not raw:return ""
    u=urllib.parse.urljoin(base,html.unescape(raw))
    low=u.lower()
    if not u.startswith(("http://","https://")):return ""
    bad=("logo","icon","avatar","sprite","favicon","tracking","pixel","banner","advert","placeholder","loading","blank","footer","header-logo","chia-se-mxh","/setting/","/templates/","/themes/images/")
    if any(x in low for x in bad) or re.search(r"\.(?:svg|ico)(?:\?|$)",low):return ""
    return u

def page_images(text,base):
    out=[]
    root=article_soup(text)
    if root is not None:
        try:
            for selector in ("script","style","noscript","svg","nav","aside","footer","form","iframe"):
                for node in root.select(selector):node.decompose()
        except Exception:pass
        try:nodes=root.select("figure,picture,img,amp-img")
        except Exception:nodes=[]
        for tag in nodes:
            u=image_from_tag(tag,base)
            if u and u not in out:out.append(u)
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

def enrich_article(item):
    original=str(item.get("url") or "").strip()
    target=decode_google_url(original)
    out=dict(item)
    if target and "news.google.com/" not in target:
        out["url"]=target
    try:
        body,final=http_get(target,DETAIL_TIMEOUT,"text/html,application/xhtml+xml;q=0.9,*/*;q=0.8")
        if UnicodeDammit is not None:
            try:text=UnicodeDammit(body,is_html=True).unicode_markup or body.decode("utf-8",errors="replace")
            except Exception:text=body.decode("utf-8",errors="replace")
        else:
            text=body.decode("utf-8",errors="replace")
    except:
        return out
    _,ji=jsonld(text); images=[]
    ordered=[
      *page_images(text,final),
      *(item.get("images") or []),
      *meta_images(text,final),
      *ji
    ]
    for u in ordered:
        u=ready_image_url(u)
        if u and u not in images:images.append(u)
    if images:out["images"]=images[:8];out["image"]=images[0]
    if final and "news.google.com/" not in final:
        out["url"]=final
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
        u=ready_image_url(u)
        if u and u not in images:images.append(u)
    fallback=ready_image_url(item.get("image"))
    if fallback and fallback not in images:images.insert(0,fallback)
    return {
      "id":str(item.get("id") or ""),"title":clean_title(item.get("title"),item.get("source_name")),"summary":clean_text(str(item.get("summary") or ""))[:420],
      "content":"","url":str(item.get("url") or ""),"image":images[0] if images else "",
      "images":images[:3],"published_at":str(item.get("published_at") or ""),"source_key":str(item.get("source_key") or ""),
      "source_name":str(item.get("source_name") or ""),"topic":str(item.get("topic") or "latest"),"duplicate_count":max(1,int(item.get("duplicate_count") or 1)),
      "also_sources":[],"hot_score":hot_score(item,now)
    }

def build_snapshot(limit=DEFAULT_LIMIT,candidate_limit=DISCOVERY_CANDIDATE_LIMIT,topic="latest"):
    # Discovery deliberately over-fetches. The UI target is limit, while the
    # processor keeps a larger candidate pool so missing thumbnails/bad titles
    # can be rejected and replaced before a READY snapshot is published.
    topic=topic if topic in TOPIC_QUERIES else "latest"
    google_queries=TOPIC_QUERIES[topic]
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        google_batches=list(pool.map(fetch_google_query,google_queries))
    items=process_items([x for batch in google_batches for x in batch]);now=dt.datetime.now(dt.timezone.utc)
    items=[x for x in items if title_is_clean(x.get("title"))]
    items.sort(key=lambda x:(hot_score(x,now),x.get("published_at") or ""),reverse=True)
    pool_limit=max(limit,min(candidate_limit,len(items)))
    for x in items:x["topic"]=topic
    rows=[compact(x,now) for x in items[:pool_limit] if x.get("title") and x.get("url")]
    newest=max((iso(x.get("published_at")) for x in rows),default=now)
    return {"version":5,"generated_at":now.isoformat().replace("+00:00","Z"),"newest_published_at":newest.isoformat().replace("+00:00","Z"),
      "newest_age_seconds":max(0,int((now-newest).total_seconds())),"strategy":"google-news-rss-only-snapshot",
      "phase":"candidate","storage":"git-ephemeral-branch","database":False,"query_count":len(google_queries),
      "topic":topic,"target_count":limit,"candidate_count":len(rows),"items":rows}

def enrich_snapshot(input_path,output_path,limit=DEFAULT_LIMIT,candidate_limit=DISCOVERY_CANDIDATE_LIMIT,topic="latest"):
    data=json.loads(pathlib.Path(input_path).read_text(encoding="utf-8"))
    topic=str(data.get("topic") or topic or "latest")
    items=list(data.get("items") or [])[:candidate_limit]
    candidates=list(items[:RICH_IMAGE_LIMIT])
    if candidates:
        pos={str(x.get("id") or ""):i for i,x in enumerate(items)}
        with concurrent.futures.ThreadPoolExecutor(max_workers=RICH_WORKERS) as pool:
            jobs={pool.submit(enrich_article,x):str(x.get("id") or "") for x in candidates}
            for future in concurrent.futures.as_completed(jobs):
                try:enriched=future.result()
                except Exception as exc:
                    print("WARN enrich",str(exc)[:120]);continue
                i=pos.get(jobs[future])
                if i is not None:items[i]=enriched
    now=dt.datetime.now(dt.timezone.utc)
    items=process_items(items)
    rejected_title=sum(1 for x in items if not title_is_clean(x.get("title")))
    rejected_url=sum(1 for x in items if title_is_clean(x.get("title")) and "news.google.com/" in str(x.get("url") or ""))
    rejected_image=0
    for x in items:
        if not title_is_clean(x.get("title")) or "news.google.com/" in str(x.get("url") or ""):continue
        images=x.get("images") or []
        image=ready_image_url(x.get("image") or (images[0] if images else ""))
        if not image:rejected_image+=1
    ready=[x for x in items if ready_item(x)]
    ready.sort(key=lambda x:(hot_score(x,now),x.get("published_at") or ""),reverse=True)
    ready=ready[:limit]
    if not ready:
        raise SystemExit("No READY news items; keep previous snapshot")
    for x in ready:x["topic"]=topic
    data["items"]=[compact(x,now) for x in ready]
    data["version"]=5
    data["phase"]="rich"
    data["ready"]=True
    data["enriched_at"]=now.isoformat().replace("+00:00","Z")
    data["target_count"]=limit
    data["candidate_count"]=len(items)
    data["ready_count"]=len(data["items"])
    data["image_count"]=len(data["items"])
    data["multi_image_count"]=sum(1 for x in data["items"] if len(x.get("images") or [])>=2)
    data["rejected"]={"title":rejected_title,"url":rejected_url,"image":rejected_image}
    pathlib.Path(output_path).write_text(json.dumps(data,ensure_ascii=False,separators=(",",":"))+"\n",encoding="utf-8")
    print("GETLINK READY news snapshot",f"ready={data['ready_count']}/{limit}",f"candidates={data['candidate_count']}",f"rejected={data['rejected']}")

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--output",required=True)
    p.add_argument("--input")
    p.add_argument("--enrich-only",action="store_true")
    p.add_argument("--limit",type=int,default=DEFAULT_LIMIT)
    p.add_argument("--candidate-limit",type=int,default=DISCOVERY_CANDIDATE_LIMIT)
    p.add_argument("--topic",choices=sorted(TOPIC_QUERIES),default="latest")
    a=p.parse_args()
    limit=max(20,min(100,a.limit))
    candidate_limit=max(limit,min(240,a.candidate_limit))
    if a.enrich_only:
        if not a.input:raise SystemExit("--input is required with --enrich-only")
        enrich_snapshot(a.input,a.output,limit,candidate_limit,a.topic)
        return
    snap=build_snapshot(limit,candidate_limit,a.topic)
    if not snap["items"]:raise SystemExit("No news items fetched; keep previous snapshot")
    out=pathlib.Path(a.output);out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps(snap,ensure_ascii=False,separators=(",",":"))+"\n",encoding="utf-8")
    print("GETLINK news candidates",f"items={len(snap['items'])}",f"target={limit}",f"newest_age_seconds={snap['newest_age_seconds']}",f"phase={snap['phase']}")

if __name__=="__main__":main()
