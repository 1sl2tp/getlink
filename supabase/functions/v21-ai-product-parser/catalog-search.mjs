function clean(value){
  return String(value??'').replace(/\s+/g,' ').trim();
}

function normalize(value){
  return String(value??'')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'')
    .replace(/đ/gi,'d')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

function tokens(value){
  return normalize(value).split(' ').filter(Boolean);
}

function quantityText(value){
  const n=Number(value);
  if(!Number.isFinite(n))return String(value??'').trim();
  return Number.isInteger(n)?String(n):String(Math.round(n*100)/100);
}

function uniqueNameMatch(rows){
  const byName=new Map();
  for(const row of rows){
    const productName=clean(row?.product_name??row?.productName);
    const key=normalize(productName);
    if(!productName||!key||byName.has(key))continue;
    byName.set(key,{productName,productCode:clean(row?.product_code??row?.productCode)});
  }
  return byName.size===1?[...byName.values()][0]:null;
}

export function findCatalogProduct(productText,catalog=[]){
  const query=normalize(productText);
  if(!query)return null;

  const rows=(Array.isArray(catalog)?catalog:[]).filter(row=>clean(row?.product_name??row?.productName));
  const exact=rows.filter(row=>normalize(row?.product_name??row?.productName)===query);
  if(exact.length)return uniqueNameMatch(exact);

  const queryTokens=tokens(query);
  if(!queryTokens.length)return null;
  const candidates=rows.filter(row=>{
    const candidateTokens=new Set(tokens(row?.product_name??row?.productName));
    return queryTokens.every(token=>candidateTokens.has(token));
  });
  return uniqueNameMatch(candidates);
}

export function resolveParsedLinesWithCatalog(lines,catalog=[]){
  return (Array.isArray(lines)?lines:[]).map(row=>{
    const rawProductName=clean(row?.productName);
    const match=findCatalogProduct(rawProductName,catalog);
    if(!match)return {...row,catalogMatched:false};

    const productName=match.productName;
    const changed=clean(productName)!==rawProductName;
    const review=changed&&rawProductName?` (${rawProductName})`:'';
    return {
      ...row,
      rawProductName,
      productName,
      productCode:match.productCode||null,
      catalogMatched:true,
      line:`${quantityText(row?.quantity)} ${productName}${review}`,
    };
  });
}
