import fs from "node:fs";
import assert from "node:assert/strict";

const source=fs.readFileSync("worker/src/index.js","utf8")
  .replace(/\bexport\s+default\b/,"const __worker_default =");

const get=new Function(
  source+
  "\nreturn {"+
  "parsePackStructure,comparisonData,productDetailPayload,categoryPayload,"+
  "getlinkProductIdentity,getlinkCartonEvidence,packHierarchyData,apiProductToPayloadProduct"+
  "};"
);

const {
  parsePackStructure,
  comparisonData,
  productDetailPayload,
  categoryPayload,
  getlinkProductIdentity,
  packHierarchyData,
  apiProductToPayloadProduct
}=get();

{
  const h=packHierarchyData(
    "Mì 3 Miền tôm chua cay gói 65g",
    "https://bachhoaxanh.com/mi-an-lien/mi-3-mien-tom-chua-cay-goi-65g",
    "Gói 65g",
    1,
    "Gói"
  );
  assert.equal(h.label1,"");
  assert.equal(h.label2,"");
  assert.equal(h.label3,"Gói");
  assert.equal(h.qty3,1);
  assert.equal(h.locked,true);
}

{
  const h=packHierarchyData(
    "Bia 333 lon 330ml",
    "https://bachhoaxanh.com/bia/bia-333-lon-330ml",
    "Lon 330ml",
    1,
    "Lon"
  );
  assert.equal(h.label1,"");
  assert.equal(h.label2,"");
  assert.equal(h.label3,"Lon");
  assert.equal(h.qty3,1);
}

{
  const h=packHierarchyData(
    "Lốc 6 lon Bia 333 330ml",
    "https://bachhoaxanh.com/bia/loc-6-lon-bia-333-330ml",
    "Lốc 6 Lon",
    6,
    "Lon"
  );
  assert.equal(h.label1,"");
  assert.equal(h.label2,"Lốc");
  assert.equal(h.qty2,1);
  assert.equal(h.label3,"Lon");
  assert.equal(h.qty3,6);
  assert.equal(h.locked,true);

  const c=comparisonData({
    name:"Lốc 6 lon Bia 333 330ml",
    url:"https://bachhoaxanh.com/bia/loc-6-lon-bia-333-330ml",
    packagingText:"Lốc 6 Lon",
    current:120000,
    sysPrice:120000,
    promoText:"",
    hierarchy:h
  });
  assert.equal(c.pack_kind,"Lốc");
  assert.equal(c.pack_quantity,6);
  assert.equal(c.pack_unit,"Lon");
  assert.equal(c.regular_middle_price,120000);
  assert.equal(c.regular_leaf_price,20000);
}

{
  const identity=getlinkProductIdentity(
    "24 lon cà phê sữa Highlands 235ml",
    "https://bachhoaxanh.com/ca-phe-lon/thung-24-lon-ca-phe-sua-highlands-235ml",
    "Lon 235ml"
  );
  assert.equal(identity.keep,true);
  assert.equal(identity.authoritativeCarton,true);
  assert.equal(identity.name,"Thùng 24 lon cà phê sữa Highlands 235ml");

  const h=packHierarchyData(
    identity.name,
    "https://bachhoaxanh.com/ca-phe-lon/thung-24-lon-ca-phe-sua-highlands-235ml",
    identity.packaging,
    24,
    "Lon"
  );
  assert.equal(h.label1,"Thùng");
  assert.equal(h.qty1,1);
  assert.equal(h.label2,"");
  assert.equal(h.qty2,0);
  assert.equal(h.label3,"Lon");
  assert.equal(h.qty3,24);
  assert.equal(h.evidence,"name");
  assert.equal(h.locked,true);

  const c=comparisonData({
    name:identity.name,
    url:"https://bachhoaxanh.com/ca-phe-lon/thung-24-lon-ca-phe-sua-highlands-235ml",
    packagingText:identity.packaging,
    current:332000,
    sysPrice:332000,
    promoText:"",
    hierarchy:h
  });
  assert.equal(c.pack_kind,"Thùng");
  assert.equal(c.pack_quantity,24);
  assert.equal(c.pack_unit,"Lon");
  assert.equal(c.regular_carton_price,332000);
  assert.equal(c.regular_middle_price,null);
  assert.equal(c.regular_leaf_price,13833);
}

{
  const h=packHierarchyData(
    "Thùng 12 lốc 4 hộp sữa demo 180ml",
    "https://bachhoaxanh.com/sua/thung-12-loc-4-hop-sua-demo-180ml",
    "Thùng 12 Lốc 4 Hộp",
    12,
    "Lốc"
  );
  assert.equal(h.label1,"Thùng");
  assert.equal(h.qty1,1);
  assert.equal(h.label2,"Lốc");
  assert.equal(h.qty2,12);
  assert.equal(h.label3,"Hộp");
  assert.equal(h.qty3,4);

  const c=comparisonData({
    name:"Thùng 12 lốc 4 hộp sữa demo 180ml",
    url:"https://bachhoaxanh.com/sua/thung-12-loc-4-hop-sua-demo-180ml",
    packagingText:"Thùng 12 Lốc 4 Hộp",
    current:480000,
    sysPrice:480000,
    promoText:"",
    hierarchy:h
  });
  assert.equal(c.regular_carton_price,480000);
  assert.equal(c.regular_middle_price,40000);
  assert.equal(c.regular_leaf_price,10000);
}

{
  const h=packHierarchyData(
    "Thùng 24 + 4 lon Bia Budweiser 250ml",
    "https://bachhoaxanh.com/bia/thung-24-4-lon-bia-budweiser-250ml",
    "Thùng 24 + 4 Lon",
    28,
    "Lon"
  );
  assert.equal(h.label1,"Thùng");
  assert.equal(h.label2,"");
  assert.equal(h.label3,"Lon");
  assert.equal(h.qty3,28);
}

{
  const blocked=[
    ["6 lon bia demo","https://bachhoaxanh.com/bia/6-lon-bia-demo","Lon"],
    ["2 túi nước giặt OMO","https://bachhoaxanh.com/nuoc-giat/2-tui-omo","Túi"],
    ["Combo 6 lon bia","https://bachhoaxanh.com/bia/combo-6-lon-bia","Lon"],
    ["2 thùng nước ngọt","https://bachhoaxanh.com/nuoc-ngot/2-thung","Thùng"],
    ["24 lon bia A và 24 lon bia B","https://bachhoaxanh.com/bia/thung-24-lon-a-va-b","Thùng 24 Lon"]
  ];
  for(const [name,url,packaging] of blocked){
    assert.equal(getlinkProductIdentity(name,url,packaging).keep,false,name);
  }
}

{
  const c=comparisonData({
    name:"Nước giặt OMO cửa trên hương Nhài trắng và Tuyết tùng túi 2.1kg",
    url:"https://bachhoaxanh.com/nuoc-giat/omo-tui-2-1kg",
    packagingText:"Túi",
    packCount:1,
    packUnit:"Túi",
    current:115000,
    sysPrice:115000,
    promoText:"MUA 2 TÚI 199K"
  });
  assert.equal(c.quantity_offer_active,true);
  assert.equal(c.quantity_offer_min_packs,2);
  assert.equal(c.quantity_offer_total_price,199000);
  assert.equal(c.promo_pack_price,99500);
  assert.equal(c.promo_leaf_price,99500);
}

{
  const h=packHierarchyData(
    "Lốc 4 hộp sữa tươi tiệt trùng socola TH true MILK 180ml",
    "https://bachhoaxanh.com/sua/loc-4-hop-th-true-milk",
    "Lốc 4 Hộp",
    4,
    "Hộp"
  );
  const c=comparisonData({
    name:"Lốc 4 hộp sữa tươi tiệt trùng socola TH true MILK 180ml",
    url:"https://bachhoaxanh.com/sua/loc-4-hop-th-true-milk",
    packagingText:"Lốc 4 Hộp",
    current:40500,
    sysPrice:40500,
    promoText:"GIẢM 5.000Đ TỪ 2 LỐC. GIẢM 20.000Đ 5 LỐC",
    hierarchy:h
  });
  assert.equal(c.pack_kind,"Lốc");
  assert.equal(c.pack_quantity,4);
  assert.equal(c.pack_unit,"Hộp");
  assert.equal(c.quantity_offer_min_packs,5);
  assert.equal(c.quantity_offer_pack_price,36500);
  assert.equal(c.promo_middle_price,36500);
  assert.equal(c.promo_leaf_price,9125);
}

{
  const payload=categoryPayload(
    "https://bachhoaxanh.com/bia",
    "test-duplicate-canonical-name",
    {
      products:[
        {
          url:"/bia/thung-24-lon-bia-heineken-silver-330ml",
          name:"Thùng 24 lon bia Heineken Silver 330ml",
          fullName:"Thùng 24 lon Bia Heineken Silver 330ml",
          canonical:"24 lon 330ml",
          unit:"Lon",
          avatar:"https://example.com/heineken.jpg",
          brandName:"Heineken",
          category:{name:"Bia, nước có cồn"},
          productPrices:[{price:469000,sysPrice:469000}]
        },
        {
          url:"https://bachhoaxanh.com/bia/thung-24-lon-bia-heineken-silver-330ml",
          name:"HEINEKEN KÈM TRỨNG 10K",
          fullName:null,
          canonical:null,
          unit:null,
          avatar:"",
          brandName:null,
          category:{name:"Bia, nước có cồn"},
          productPrices:null
        }
      ]
    }
  );
  assert.equal(payload.schema_version,20);
  assert.equal(payload.products.length,1);
  assert.equal(payload.filter_summary.duplicate_count,1);
  assert.equal(payload.products[0].name,"Thùng 24 lon Bia Heineken Silver 330ml");
  assert.equal(payload.products[0].hierarchy.label1,"Thùng");
  assert.equal(payload.products[0].hierarchy.label2,"");
  assert.equal(payload.products[0].hierarchy.label3,"Lon");
  assert.equal(payload.products[0].hierarchy.qty3,24);
}

{
  const input="https://bachhoaxanh.com/bia/thung-24-lon-heineken-silver-330ml";
  const data={
    categoryName:"Bia, nước có cồn",
    boxBuys:[{
      id:1,
      url:"/bia/thung-24-lon-heineken-silver-330ml",
      name:"Thùng 24 lon Bia Heineken Silver 330ml",
      title:"Thùng 24 Lon",
      packageItemCount:24,
      packageItemUnit:"Lon",
      productPrices:[{price:469000,sysPrice:469000,discountPercent:0}]
    }]
  };
  const payload=productDetailPayload(input,"test",data);
  assert.equal(payload.schema_version,20);
  assert.equal(payload.product.comparison.pack_kind,"Thùng");
  assert.equal(payload.product.comparison.regular_carton_price,469000);
  assert.equal(payload.product.comparison.regular_leaf_price,19542);
}

console.log("pack hierarchy tests passed");
