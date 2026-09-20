const COLLECTION="https://www.vinamilk.com.vn/collections/sua-tuoi?src=ALL";
const GQL="https://open-p04-vn.vinamilk.com.vn/api/graphql-pub/";

function oneLine(v){return String(v||"").replace(/\s+/g," ").slice(0,1200);}

async function postGraphql(operationName,query,variables={}){
  const r=await fetch(GQL,{
    method:"POST",
    headers:{
      "accept":"application/json, text/plain, */*",
      "content-type":"application/json",
      "origin":"https://www.vinamilk.com.vn",
      "referer":"https://www.vinamilk.com.vn/",
      "x-language":"vi",
      "user-agent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36"
    },
    body:JSON.stringify({operationName,variables,query})
  });
  const text=await r.text();
  let json=null;
  try{json=JSON.parse(text);}catch{}
  console.log("VNM_GQL",operationName,"status",r.status,"body",oneLine(text));
  return {r,text,json};
}

const htmlRes=await fetch(COLLECTION,{
  headers:{
    "accept":"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language":"vi-VN,vi;q=0.9,en;q=0.7",
    "cache-control":"no-cache",
    "pragma":"no-cache",
    "user-agent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36"
  },
  redirect:"follow"
});
const html=await htmlRes.text();
const htmlUseful=htmlRes.ok && (html.includes('"variants":[')||html.includes("originPrice")||html.includes("packagingValue"));
console.log("VNM_HTML status",htmlRes.status,"useful",htmlUseful,"body",oneLine(html));

const shelfQuery=`query GetEShopProductShelf($payload: eshop_getProductGroupsRequest!) {
  eshop_getProductGroups(payload: $payload) {
    handle
    products {
      productId
      productType: attributes(attributeCodes: ["TYPE"]) { attributeValue }
      productUom: attributes(attributeCodes: ["UOM"]) { attributeValue }
      handle
      suffix
      packagingValue
      variants { variantId name thumbnail }
    }
  }
}`;
const shelf=await postGraphql("GetEShopProductShelf",shelfQuery,{
  payload:{attribute:{attributeName:"TYPE",attributeValue:"Sữa Tươi Vinamilk 100%"}}
});
const groups=shelf.json?.data?.eshop_getProductGroups;
const shelfUseful=Array.isArray(groups)?groups.some(g=>Array.isArray(g?.products)&&g.products.length>0):Boolean(groups?.products?.length);

const schema=await postGraphql("VinamilkSchemaProbe",`query VinamilkSchemaProbe {
  __schema { queryType { fields { name } } }
}`);
const queryFields=schema.json?.data?.__schema?.queryType?.fields;
if(Array.isArray(queryFields)){
  const names=queryFields.map(x=>x?.name).filter(x=>/eshop|product/i.test(String(x||"")));
  console.log("VNM_SCHEMA_FIELDS",names.slice(0,120).join(","));
}

if(!htmlUseful&&!shelfUseful){
  console.error("Vinamilk live probe failed: neither server-rendered collection nor unsigned ProductShelf GraphQL returned usable product data.");
  process.exit(1);
}
console.log("Vinamilk live transport probe: OK",{htmlUseful,shelfUseful});
