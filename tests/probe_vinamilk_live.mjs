const base="https://www.vinamilk.com.vn";
async function grab(path){
  const r=await fetch(base+path,{headers:{"user-agent":"Mozilla/5.0","accept":"*/*"},redirect:"follow"});
  const text=await r.text();
  console.log("FETCH",path,r.status,text.length);
  return text;
}
const page=await grab("/collections/sua-tuoi?src=ALL");
console.log("PAGE_403",page.includes("403 ERROR"));
for(const path of [
  "/_next/static/chunks/3893-516714ed7d90043f.js",
  "/_next/static/chunks/5202-8f7a4caf9d5f512c.js",
  "/_next/static/PLIMgmRUYT9GNHUiKuRcf/_buildManifest.js",
  "/_next/static/PLIMgmRUYT9GNHUiKuRcf/_ssgManifest.js"
]){
  const t=await grab(path);
  for(const term of ["10059:","getClientInfos","VNM_SIGNATURE_SALT","VNM_CLIENT_ID","VNM_X_TERMINAL","graphql-pub"]){
    const i=t.indexOf(term);
    if(i>=0) console.log("HIT",path,term,t.slice(Math.max(0,i-500),i+1800).replace(/\s+/g," "));
  }
}
