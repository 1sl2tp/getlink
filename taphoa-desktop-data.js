(()=>{
  "use strict";

  const AUTH_KEY="getlink:chat-order-auth";
  const API_KEY=String(window.GETLINK_API_KEY||"");
  const CATALOG_API=String(window.GETLINK_API_BASE||"").replace(/\/+$/,"");
  const ORDER_API=CATALOG_API.replace(/\/getlink-api$/,"/getlink-orders");
  const PRODUCT_ADD_API=CATALOG_API.replace(/\/getlink-api$/,"/getlink-product-add");

  let productIndex=[];
  let productByKey=new Map();
  let indexVersion=0;

  function normalize(value){
    return String(value||"")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g,"")
      .replace(/đ/g,"d")
      .replace(/Đ/g,"D")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g," ")
      .trim();
  }

  function stableProductKey(row){
    return String(row?.canonical_url||row?.url||row?.id||"").trim().toLowerCase();
  }

  function taphoaRow(row){
    try{
      if(typeof isMineRow==="function")return Boolean(isMineRow(row));
    }catch{}
    return String(row?.source_key||row?.source||row?.supplier_source_key||"").toLowerCase()==="mine";
  }

  function productSearchText(row){
    return normalize([
      row?.name,
      row?.canonical_name,
      row?.source_name,
      row?.supplier_source_name,
      row?.manual_group_name,
      row?.group_name,
      row?.brand,
      row?.volume,
      row?.weight,
      row?.canonical_url,
    ].filter(Boolean).join(" "));
  }

  function scoreEntry(entry,tokens,raw){
    if(!tokens.length)return 0;
    const key=entry.searchKey;
    let score=0;
    if(key===raw)score+=1000;
    if(key.startsWith(raw))score+=500;
    const nameKey=entry.nameKey;
    if(nameKey.startsWith(tokens[0]))score+=240;
    if(nameKey.includes(raw))score+=140;
    for(const token of tokens){
      const pos=key.indexOf(token);
      if(pos<0)return -1;
      score+=Math.max(10,80-Math.min(70,pos));
    }
    return score;
  }

  function buildTaphoaIndex(rows){
    const source=Array.isArray(rows)?rows:[];
    productIndex=[];
    productByKey=new Map();
    for(const row of source){
      if(!taphoaRow(row))continue;
      const key=stableProductKey(row);
      if(!key)continue;
      const entry={row,key,searchKey:productSearchText(row),nameKey:normalize(row?.name||row?.canonical_name||"")};
      productIndex.push(entry);
      productByKey.set(key,entry);
    }
    indexVersion+=1;
    return productIndex.length;
  }

  function buildProductIndex(rows){
    const source=Array.isArray(rows)
      ?rows
      :(typeof libraryCache!=="undefined"&&Array.isArray(libraryCache)?libraryCache:[]);
    return buildTaphoaIndex(source);
  }

  function ensureProductIndex(){
    if(!productIndex.length)buildProductIndex();
    return productIndex;
  }

  function searchProducts(query,limit=80){
    const rows=ensureProductIndex();
    const raw=normalize(query);
    const max=Math.max(1,Math.min(300,Number(limit)||80));
    if(!raw)return rows.slice(0,max).map(entry=>entry.row);
    const tokens=raw.split(/\s+/).filter(Boolean);
    return rows
      .map(entry=>({entry,score:scoreEntry(entry,tokens,raw)}))
      .filter(item=>item.score>=0)
      .sort((a,b)=>b.score-a.score||a.entry.nameKey.localeCompare(b.entry.nameKey,"vi"))
      .slice(0,max)
      .map(item=>item.entry.row);
  }

  function upsertProduct(row){
    if(!row||!taphoaRow(row))return false;
    const key=stableProductKey(row);
    if(!key)return false;
    const next={row,key,searchKey:productSearchText(row),nameKey:normalize(row?.name||row?.canonical_name||"")};
    const previous=productByKey.get(key);
    if(previous){
      const index=productIndex.indexOf(previous);
      if(index>=0)productIndex[index]=next;
    }else{
      productIndex.push(next);
    }
    productByKey.set(key,next);
    indexVersion+=1;
    return true;
  }

  function readAuth(){
    try{
      const value=JSON.parse(sessionStorage.getItem(AUTH_KEY)||"null");
      if(!value?.accessToken||!value?.account?.id||value?.source!=="chat")return null;
      if(value.expiresAt&&Date.parse(value.expiresAt)<=Date.now()+5000)return null;
      return value;
    }catch{return null;}
  }

  function authHeaders(jsonBody=false){
    const headers=new Headers();
    if(API_KEY)headers.set("apikey",API_KEY);
    const token=String(readAuth()?.accessToken||"");
    if(token)headers.set("authorization","Bearer "+token);
    if(jsonBody)headers.set("content-type","application/json");
    return headers;
  }

  async function jsonRequest(url,options={}){
    const request={...options,headers:authHeaders(Boolean(options.body))};
    const response=await fetch(url,request);
    const data=await response.json().catch(()=>({}));
    if(!response.ok){
      const error=new Error(String(data.error||data.detail||"Không thực hiện được."));
      error.status=response.status;
      throw error;
    }
    return data;
  }

  function orderRequest(path,options={}){
    return jsonRequest(ORDER_API+String(path||""),options);
  }

  function productAddRequest(payload){
    return jsonRequest(PRODUCT_ADD_API,{
      method:"POST",
      body:JSON.stringify(payload||{}),
    });
  }

  window.TaphoaDesktopData={
    normalize,
    stableProductKey,
    buildProductIndex,
    searchProducts,
    upsertProduct,
    readAuth,
    orderRequest,
    productAddRequest,
    get productCount(){return productIndex.length;},
    get indexVersion(){return indexVersion;},
  };
})();
