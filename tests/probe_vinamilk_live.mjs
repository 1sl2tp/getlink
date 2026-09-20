const url="https://www.vinamilk.com.vn/collections/sua-tuoi?src=ALL";
const r=await fetch(url,{headers:{
  "accept":"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language":"vi-VN,vi;q=0.9,en;q=0.7",
  "user-agent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36"
},redirect:"follow"});
const text=await r.text();
const count=(s)=>(text.match(new RegExp(s,"g"))||[]).length;
console.log("VNM_PROBE_STATUS",r.status);
console.log("VNM_PROBE_URL",r.url);
console.log("VNM_PROBE_LEN",text.length);
console.log("VNM_PROBE_ORIGIN_PRICE_HITS",count("originPrice"));
console.log("VNM_PROBE_VARIANT_ID_HITS",count("variantId"));
console.log("VNM_PROBE_CLOUDFRONT_HITS",count("cloudfront\\.net"));
console.log("VNM_PROBE_GRAPHQL_HINT",text.includes("GetEShopProductSelectors"));
console.log("VNM_PROBE_SNIP",text.slice(0,300).replace(/\s+/g," "));
