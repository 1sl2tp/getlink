import fs from "node:fs";
import assert from "node:assert/strict";

const source=fs.readFileSync("worker/src/index.js","utf8")
  .replace(/\bexport\s+default\b/,"const __worker_default =");

const get=new Function(
  source+
  "\nreturn {goPackHierarchy,goPackagingText,comparisonData,canonicalGo,sourceKeyForUrl};"
);

const {
  goPackHierarchy,
  goPackagingText,
  comparisonData,
  canonicalGo,
  sourceKeyForUrl
}=get();

{
  const h=goPackHierarchy(
    "Thùng 24 mì Siukay hải sản 128g",
    "https://sieuthi-go.vn/product/thung-24-mi-siukay-hai-san-128g-22038-i.477244"
  );
  assert.equal(h.label1,"Thùng");
  assert.equal(h.label2,"");
  assert.equal(h.label3,"Gói");
  assert.equal(h.qty3,24);
  assert.equal(goPackagingText(h),"Thùng 24 Gói");

  const c=comparisonData({
    name:"Thùng 24 mì Siukay hải sản 128g",
    url:"",
    packagingText:goPackagingText(h),
    current:308000,
    sysPrice:308000,
    promoText:"",
    hierarchy:h
  });
  assert.equal(c.regular_carton_price,308000);
  assert.equal(c.regular_leaf_price,12833);
}

{
  const h=goPackHierarchy(
    "Mì Hảo Hảo tôm chua cay gói 75g",
    "https://sieuthi-go.vn/product/mi-hao-hao-tom-chua-cay-goi-75g-38165-i.73769"
  );
  assert.equal(h.label1,"");
  assert.equal(h.label2,"");
  assert.equal(h.label3,"Gói");
  assert.equal(h.qty3,1);
}

{
  const h=goPackHierarchy(
    "Mì 3 Miền Reeva bò hầm gói 75g",
    "https://sieuthi-go.vn/product/mi-3-mien-reeva-bo-ham-goi-75g-i.999"
  );
  assert.equal(h.label3,"Gói");
  assert.equal(h.qty3,1);
}

{
  const h=goPackHierarchy(
    "Lốc 6 lon nước ngọt demo 330ml",
    "https://sieuthi-go.vn/product/loc-6-lon-nuoc-ngot-demo-330ml-i.123"
  );
  assert.equal(h.label1,"");
  assert.equal(h.label2,"Lốc");
  assert.equal(h.qty2,1);
  assert.equal(h.label3,"Lon");
  assert.equal(h.qty3,6);
}

{
  const h=goPackHierarchy(
    "Thùng 12 lốc 4 hộp sữa demo 180ml",
    "https://sieuthi-go.vn/product/thung-12-loc-4-hop-sua-demo-180ml-i.123"
  );
  assert.equal(h.label1,"Thùng");
  assert.equal(h.label2,"Lốc");
  assert.equal(h.qty2,12);
  assert.equal(h.label3,"Hộp");
  assert.equal(h.qty3,4);
}

assert.equal(
  canonicalGo("https://www.sieuthi-go.vn/categories/sua-cac-loai-i.81?x=1"),
  "https://sieuthi-go.vn/categories/sua-cac-loai-i.81"
);
assert.equal(
  sourceKeyForUrl("https://sieuthi-go.vn/categories/sua-cac-loai-i.81"),
  "go"
);

console.log("GO source parser tests passed");
