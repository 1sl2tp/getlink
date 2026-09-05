import argparse,asyncio,csv,json,re
from datetime import datetime,timezone
from urllib.parse import urlparse
from pathlib import Path
from playwright.async_api import async_playwright
HOST="bachhoaxanh.com"
BAD_PATH=("tin-tuc","blog","khuyen-mai","kinh-nghiem-hay")
def valid_category(url):
 u=urlparse(url); h=(u.hostname or "").lower()
 return u.scheme in ("http","https") and h in (HOST,"www."+HOST)
def clean(s): return re.sub(r"\s+"," ",s or "").strip()
def price(t):
 m=re.search(r"(\d{1,3}(?:[.,]\d{3})+|\d{4,8})\s*(?:đ|₫)",t,re.I); return m.group(0) if m else ""
def packaging(t):
 for p in [r"\b\d+(?:[.,]\d+)?\s*(?:kg|g|mg|l|ml)\b",r"\b(?:chai|hộp|túi|gói|lon|thùng|hũ)\s+\d+(?:[.,]\d+)?\s*(?:kg|g|l|ml)\b",r"\b\d+\s*(?:cái|viên)\b"]:
  m=re.search(p,t,re.I)
  if m:return m.group(0)
 return ""
async def jsonld(page):
 out=[]
 for raw in await page.locator('script[type="application/ld+json"]').all_text_contents():
  try:
   x=json.loads(raw);out += x if isinstance(x,list) else [x]
  except: pass
 return out
async def parse_product(page,url):
 data={}
 for x in await jsonld(page):
  if isinstance(x,dict) and (x.get("@type")=="Product" or "Product" in (x.get("@type") or [])): data=x;break
 name=data.get("name") or ""; image=data.get("image") or ""
 if isinstance(image,list): image=image[0] if image else ""
 offers=data.get("offers") or {}
 if isinstance(offers,list): offers=offers[0] if offers else {}
 pr=str(offers.get("price") or "")
 body=clean(await page.locator("body").inner_text(timeout=5000))
 if not name:
  try:name=clean(await page.locator("h1").first.inner_text(timeout=3000))
  except:pass
 if not pr:pr=price(body)
 if not image:
  try:image=await page.locator('meta[property="og:image"]').get_attribute("content")
  except:pass
 return {"name":name,"price":pr,"packaging":packaging(body[:12000]),"url":url,"image":image or ""}
async def run(category):
 if not valid_category(category): raise ValueError("URL phải thuộc bachhoaxanh.com")
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True)
  ctx=await browser.new_context(locale="vi-VN",timezone_id="Asia/Ho_Chi_Minh",viewport={"width":1440,"height":1000})
  page=await ctx.new_page(); responses=[]
  async def on_response(r):
   if "json" in (r.headers.get("content-type") or "").lower() and "bachhoaxanh.com" in r.url: responses.append(r.url)
  page.on("response",on_response)
  await page.goto(category,wait_until="domcontentloaded",timeout=60000);await page.wait_for_timeout(5000)
  for _ in range(18):
   await page.mouse.wheel(0,2500);await page.wait_for_timeout(700)
  links=await page.locator("a[href]").evaluate_all("els=>els.map(a=>a.href).filter(Boolean)")
  base=urlparse(category).path.rstrip("/");c=[]
  for u in links:
   q=urlparse(u)
   if q.hostname not in (HOST,"www."+HOST) or q.path.rstrip("/")==base:continue
   if any("/"+x in q.path.lower() for x in BAD_PATH):continue
   c.append(u.split("#")[0])
  c=list(dict.fromkeys(c))[:250]; products=[]
  for u in c:
   pp=None
   try:
    pp=await ctx.new_page();await pp.goto(u,wait_until="domcontentloaded",timeout=30000);await pp.wait_for_timeout(400)
    body=clean(await pp.locator("body").inner_text(timeout=5000)); title=(await pp.title()).lower()
    if "bách hóa xanh" in title or "bách hóa xanh" in body.lower():
     x=await parse_product(pp,u)
     if x["name"] and (x["price"] or await pp.locator("script[type='application/ld+json']").count()):products.append(x)
   except Exception: pass
   finally:
    if pp:
     try:await pp.close()
     except:pass
  seen=set();uniq=[]
  for x in products:
   if x["url"] not in seen:seen.add(x["url"]);uniq.append(x)
  await browser.close()
  return {"source_url":category,"updated_at":datetime.now(timezone.utc).isoformat(),"products":uniq,"discovered_json_requests":responses[:100]}
def main():
 ap=argparse.ArgumentParser();ap.add_argument("--url",required=True);a=ap.parse_args()
 r=asyncio.run(run(a.url));Path("data").mkdir(exist_ok=True);Path("data/products.json").write_text(json.dumps(r,ensure_ascii=False,indent=2),encoding="utf-8")
 with open("data/products.csv","w",newline="",encoding="utf-8-sig") as f:
  w=csv.DictWriter(f,fieldnames=["name","price","packaging","url","image"]);w.writeheader();w.writerows(r["products"])
 print("products=",len(r["products"]))
if __name__=="__main__":main()
