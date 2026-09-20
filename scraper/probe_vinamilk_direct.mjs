import crypto from "node:crypto";

const ENDPOINT = "https://open-p04-vn.vinamilk.com.vn/api/graphql-pub/";
const ENDPOINT_PATH = "/api/graphql-pub/";
const CLIENT_ID = "54SQs8Rii747anXFUIFsiCxa7kI91drT";
const TERMINAL = "2188400000000124";
const EXTERNAL_CODE = "35766930226f44e48e8e9f373217cf755";
const SIGNATURE_SALT = "89fYD1YM2ESML5nXy6nPz0zOeh6UWauS";
const DEVICE_INFO = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";

const operationName = "GetEShopProductShelf";
const variables = {
  payload: {
    attribute: {
      attributeName: "TYPE",
      attributeValue: "Sữa Tươi Vinamilk 100%"
    }
  }
};
const query = `query GetEShopProductShelf($payload: eshop_getProductGroupsRequest!) {
  eshop_getProductGroups(payload: $payload) {
    handle
    products {
      productId
      productType: attributes(attributeCodes: ["TYPE"]) {
        attributeValue
        __typename
      }
      productUom: attributes(attributeCodes: ["UOM"]) {
        attributeValue
        __typename
      }
      handle
      suffix
      packagingValue
      variants {
        variantId
        name
        thumbnail
        __typename
      }
      __typename
    }
    __typename
  }
}`;

function sha256(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

const graphqlHash = sha256(JSON.stringify({ operationName, variables, query }));
const timestamp = Date.now().toString();
const signature = sha256([
  ENDPOINT_PATH,
  timestamp,
  DEVICE_INFO,
  graphqlHash,
  SIGNATURE_SALT
].join("."));

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
console.log("VNM_DIRECT_STATUS", response.status);
console.log("VNM_DIRECT_META", JSON.stringify({
  graphqlHash,
  signatureLength: signature.length,
  bytes: text.length
}));
console.log("VNM_DIRECT_BODY", text.slice(0, 5000));

if (!response.ok) process.exit(2);
let data;
try { data = JSON.parse(text); }
catch { process.exit(3); }
if (data?.errors?.length) process.exit(4);
const groups = data?.data?.eshop_getProductGroups;
if (!Array.isArray(groups) || !groups.some(g => Array.isArray(g?.products) && g.products.some(p => p?.productId && p?.variants?.some(v => v?.variantId)))) {
  process.exit(5);
}
console.log("VNM_DIRECT_OK", JSON.stringify({
  groups: groups.length,
  products: groups.reduce((n, g) => n + (Array.isArray(g?.products) ? g.products.length : 0), 0)
}));
