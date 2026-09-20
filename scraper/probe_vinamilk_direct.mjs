import crypto from "node:crypto";

const ENDPOINT = "https://open-p04-vn.vinamilk.com.vn/api/graphql-pub/";
const ENDPOINT_PATH = "/api/graphql-pub/";
const CLIENT_ID = "54SQs8Rii747anXFUIFsiCxa7kI91drT";
const TERMINAL = "2188400000000124";
const EXTERNAL_CODE = "35766930226f44e48e8e9f373217cf755";
const SIGNATURE_SALT = "89fYD1YM2ESML5nXy6nPz0zOeh6UWauS";
const DEVICE_INFO = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";

function sha256(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}
async function signedPost(operationName, variables, query) {
  const graphqlHash = sha256(JSON.stringify({ operationName, variables, query }));
  const timestamp = Date.now().toString();
  const signature = sha256([ENDPOINT_PATH, timestamp, DEVICE_INFO, graphqlHash, SIGNATURE_SALT].join("."));
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      accept: "*/*",
      "content-type": "application/json",
      origin: "https://www.vinamilk.com.vn",
      referer: "https://www.vinamilk.com.vn/",
      "client-id": CLIENT_ID,
      "x-device-info": DEVICE_INFO,
      "x-external-code": EXTERNAL_CODE,
      "x-graphql-hash": graphqlHash,
      "x-language": "vi",
      "x-signature": signature,
      "x-terminal": TERMINAL,
      "x-timestamp": timestamp,
      "x-trace-group": operationName,
      "user-agent": DEVICE_INFO
    },
    body: JSON.stringify({ operationName, variables, query })
  });
  const text = await response.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  console.log("VNM_DIRECT", JSON.stringify({
    operationName,
    status: response.status,
    bytes: text.length,
    graphqlHash,
    errors: data?.errors || null
  }));
  if (!response.ok || !data) throw new Error(operationName + "_http_" + response.status + ":" + text.slice(0,1200));
  return data;
}

const shelfQuery = `query GetEShopProductShelf($payload: eshop_getProductGroupsRequest!) {
  eshop_getProductGroups(payload: $payload) {
    handle
    products {
      productId
      productType: attributes(attributeCodes: ["TYPE"]) { attributeValue __typename }
      productUom: attributes(attributeCodes: ["UOM"]) { attributeValue __typename }
      handle
      suffix
      packagingValue
      variants { variantId name thumbnail __typename }
      __typename
    }
    __typename
  }
}`;
const shelf = await signedPost("GetEShopProductShelf", {
  payload: { attribute: { attributeName: "TYPE", attributeValue: "Sữa Tươi Vinamilk 100%" } }
}, shelfQuery);
const groups = shelf?.data?.eshop_getProductGroups;
if (!Array.isArray(groups) || !groups.some(g => g?.products?.some(p => p?.variants?.some(v => v?.variantId)))) {
  throw new Error("vinamilk_shelf_shape_invalid");
}
console.log("VNM_SHELF_OK", JSON.stringify({
  groups: groups.length,
  products: groups.reduce((n,g)=>n+(Array.isArray(g?.products)?g.products.length:0),0)
}));

const inputType = await signedPost("GetEShopSearchInputType", {
  name: "eshop_getSearchProductRequest"
}, `query GetEShopSearchInputType($name: String!) {
  __type(name: $name) {
    name
    inputFields {
      name
      type { kind name ofType { kind name ofType { kind name } } }
    }
  }
}`);
console.log("VNM_SEARCH_INPUT_TYPE", JSON.stringify(inputType));

const inputFields = new Set(
  (inputType?.data?.__type?.inputFields || []).map(x => String(x?.name || ""))
);
const payload = {};
if (inputFields.has("category")) payload.category = "sua-tuoi";
if (inputFields.has("offset")) payload.offset = 0;
if (inputFields.has("size")) payload.size = 12;
if (inputFields.has("sortType")) payload.sortType = "RELEVANCE";
if (inputFields.has("categorySlug")) payload.categorySlug = "sua-tuoi";
if (inputFields.has("categorySlugs")) payload.categorySlugs = ["sua-tuoi"];

const searchQuery = `query GetEShopProductSelectors($payload: eshop_getSearchProductRequest!) {
  eshop_searchProducts(payload: $payload) {
    total
    __typename
  }
}`;
const search = await signedPost("GetEShopProductSelectors", { payload }, searchQuery);
console.log("VNM_SEARCH_PROBE", JSON.stringify({ payload, response: search }));
if (search?.errors?.length) process.exit(6);
const searchRoot = search?.data?.eshop_searchProducts;
if (!searchRoot || !Number.isFinite(Number(searchRoot.total))) process.exit(7);

const typeName = String(searchRoot.__typename || "");
if (typeName) {
  const introspection = await signedPost("GetEShopSearchType", { name: typeName }, `query GetEShopSearchType($name: String!) {
    __type(name: $name) {
      name
      fields {
        name
        type { kind name ofType { kind name ofType { kind name } } }
      }
    }
  }`);
  console.log("VNM_SEARCH_TYPE", JSON.stringify(introspection));
}
console.log("VNM_DIRECT_OK");
