from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, got {count}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    ".github/scripts/build_news_snapshot.py",
    '''      "logo","favicon","sprite","tracking","pixel","placeholder","loading","blank",
      "footer","header-logo","site-logo","brand-logo","chia-se-mxh","share-default",
      "/setting/","/settings/","/template/","/templates/","/themes/images/",
      "default-image","default_image","social-default"''',
    '''      "logo","icon","avatar","sprite","favicon","tracking","pixel","banner","advert",
      "placeholder","loading","blank","footer","header-logo","site-logo","brand-logo",
      "chia-se-mxh","share-default","/setting/","/settings/","/template/","/templates/",
      "/themes/images/","default-image","default_image","social-default",
      "google-news","google_news","googlenews","img-author","author-avatar",
      "avatar-author","author-default","no-image","no_image","image-not-found"'''
)
replace_once(
    ".github/scripts/build_news_snapshot.py",
    '''    low=u.lower()
    if not u.startswith(("http://","https://")):return ""
    bad=("logo","icon","avatar","sprite","favicon","tracking","pixel","banner","advert","placeholder","loading","blank","footer","header-logo","chia-se-mxh","/setting/","/templates/","/themes/images/")
    if any(x in low for x in bad) or re.search(r"\\.(?:svg|ico)(?:\\?|$)",low):return ""
    return u''',
    '''    return ready_image_url(u)'''
)

replace_once(
    "app.js",
    '''function newsImageCandidates(item){''',
    '''const NEWS_BAD_IMAGE_FRAGMENTS=[
  "logo","icon","avatar","sprite","favicon","tracking","pixel","banner","advert",
  "placeholder","loading","blank","footer","header-logo","site-logo","brand-logo",
  "chia-se-mxh","share-default","/setting/","/settings/","/template/","/templates/",
  "/themes/images/","default-image","default_image","social-default",
  "google-news","google_news","googlenews","img-author","author-avatar",
  "avatar-author","author-default","no-image","no_image","image-not-found"
];
function newsImageUrlUsable(value){
  const url=String(value||"").trim();
  if(!/^https?:\\/\\//i.test(url))return false;
  const low=url.toLowerCase();
  if(NEWS_BAD_IMAGE_FRAGMENTS.some(fragment=>low.includes(fragment)))return false;
  if(/\\.(?:svg|ico|woff2?|ttf|otf|css|js|json|pdf|xml)(?:[?#]|$)/i.test(low))return false;
  return true;
}
function newsImageCandidates(item){'''
)
replace_once(
    "app.js",
    '''    if(/^https?:\\/\\//i.test(url)&&!out.includes(url))out.push(url);''',
    '''    if(newsImageUrlUsable(url)&&!out.includes(url))out.push(url);'''
)
replace_once(
    "app.js",
    '''      }else if(block.type==="image"&&/^https?:\\/\\//i.test(String(block.url||""))){''',
    '''      }else if(block.type==="image"&&newsImageUrlUsable(block.url)){'''
)
replace_once(
    "app.js",
    '''    .filter((url,index,all)=>url&&all.indexOf(url)===index)''',
    '''    .filter((url,index,all)=>newsImageUrlUsable(url)&&all.indexOf(url)===index)'''
)

replace_once(
    "supabase/functions/getlink-api/index.ts",
    '''function newsImagesFromItem(block:string,description:string,content:string){
  const values:string[]=[];
  const add=(value:unknown)=>{
    const url=newsAbsoluteImage(value);''',
    '''const NEWS_BAD_IMAGE_FRAGMENTS=[
  "logo","icon","avatar","sprite","favicon","tracking","pixel","banner","advert",
  "placeholder","loading","blank","footer","header-logo","site-logo","brand-logo",
  "chia-se-mxh","share-default","/setting/","/settings/","/template/","/templates/",
  "/themes/images/","default-image","default_image","social-default",
  "google-news","google_news","googlenews","img-author","author-avatar",
  "avatar-author","author-default","no-image","no_image","image-not-found"
];
function newsUsableImageUrl(value:unknown,base=""){
  const url=newsAbsoluteImage(value,base);
  if(!url)return "";
  const low=url.toLowerCase();
  if(NEWS_BAD_IMAGE_FRAGMENTS.some((fragment)=>low.includes(fragment)))return "";
  if(/\\.(?:svg|ico|woff2?|ttf|otf|css|js|json|pdf|xml)(?:[?#]|$)/i.test(low))return "";
  return url;
}
function newsImagesFromItem(block:string,description:string,content:string){
  const values:string[]=[];
  const add=(value:unknown)=>{
    const url=newsUsableImageUrl(value);'''
)
replace_once(
    "supabase/functions/getlink-api/index.ts",
    '''  const url=newsAbsoluteUrl(raw,base);
  const low=url.toLowerCase();
  if(!url)return "";
  const bad=["logo","icon","avatar","sprite","favicon","tracking","pixel","banner","advert","placeholder","loading","blank","footer","header-logo","site-logo","brand-logo","chia-se-mxh","share-default","/setting/","/settings/","/template/","/templates/","/themes/images/","default-image","default_image","social-default"];
  if(bad.some(x=>low.includes(x)))return "";
  if(/\\.(?:svg|ico|woff2?|ttf|otf|css|js|json|pdf|xml)(?:[?#]|$)/i.test(low))return "";
  return url;''',
    '''  const url=newsAbsoluteUrl(raw,base);
  return newsUsableImageUrl(url);'''
)
