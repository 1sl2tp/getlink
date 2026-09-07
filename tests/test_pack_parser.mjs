import fs from "node:fs";
import assert from "node:assert/strict";

const source = fs.readFileSync("worker/src/index.js","utf8")
  .replace(/\bexport\s+default\b/,"const __worker_default =");
const get = new Function(source + "\nreturn {parsePackStructure,comparisonData,productDetailPayload};");
const {parsePackStructure,comparisonData,productDetailPayload} = get();

{
  const p = parsePackStructure("6 lon bia Budweiser 330ml","","",1,"");
  assert.equal(p.pack_kind,"Cụm");
  assert.equal(p.pack_quantity,6);
  assert.equal(p.pack_unit,"Lon");
  assert.equal(p.size_value,330);
  assert.equal(p.size_unit,"ml");
}

{
  const p = parsePackStructure("Thùng 48 hộp sữa tươi 180ml","","",1,"");
  assert.equal(p.pack_kind,"Thùng");
  assert.equal(p.pack_quantity,48);
  assert.equal(p.pack_unit,"Hộp");
  assert.equal(p.size_value,180);
  assert.equal(p.size_unit,"ml");
}

{
  const p = parsePackStructure("Bia Budweiser lon 330ml","","",1,"");
  assert.equal(p.pack_kind,"Lon");
  assert.equal(p.pack_quantity,1);
  assert.equal(p.pack_unit,"Lon");
  assert.equal(p.size_value,330);
  assert.equal(p.size_unit,"ml");
}

{
  const p = parsePackStructure(
    "Thùng 24 + 4 lon Bia Budweiser 250ml","","",1,""
  );
  assert.equal(p.pack_kind,"Thùng");
  assert.equal(p.pack_quantity,28);
  assert.equal(p.pack_unit,"Lon");
  assert.equal(p.size_value,250);
  assert.equal(p.size_unit,"ml");
}

{
  const p = parsePackStructure(
    "Bia Blanc 1664 lon 330ml","","",1,""
  );
  assert.equal(p.pack_kind,"Lon");
  assert.equal(p.pack_quantity,1);
  assert.equal(p.pack_unit,"Lon");
  assert.equal(p.size_value,330);
  assert.equal(p.size_unit,"ml");
}

{
  const p = parsePackStructure(
    "Lốc 6 lon Bia Blanc 1664 330ml","","",1,""
  );
  assert.equal(p.pack_kind,"Lốc");
  assert.equal(p.pack_quantity,6);
  assert.equal(p.pack_unit,"Lon");
  assert.equal(p.size_value,330);
  assert.equal(p.size_unit,"ml");
}

{
  const p = parsePackStructure(
    "Bia 333 lon 330ml","","",1,""
  );
  assert.equal(p.pack_kind,"Lon");
  assert.equal(p.pack_quantity,1);
  assert.equal(p.pack_unit,"Lon");
  assert.equal(p.size_value,330);
  assert.equal(p.size_unit,"ml");
}

{
  const c = comparisonData({
    name:"Thùng 24 + 4 lon Bia Budweiser 250ml",
    packagingText:"",
    featureText:"",
    packCount:1,
    packUnit:"",
    current:355000,
    sysPrice:355000,
    discount:0,
    promoText:""
  });
  assert.equal(c.pack_quantity,28);
  assert.equal(c.regular_unit_price,12679);
}

{
  const c = comparisonData({
    name:"6 lon bia Budweiser 330ml",
    packagingText:"",
    featureText:"",
    packCount:1,
    packUnit:"",
    current:120000,
    sysPrice:120000,
    discount:0,
    promoText:""
  });
  assert.equal(c.regular_unit_price,20000);
}


{
  const input="https://bachhoaxanh.com/bia/thung-24-lon-heineken-silver-330ml";
  const data={
    categoryName:"Bia, nước có cồn",
    boxBuys:[
      {
        id:1,
        url:"/bia/thung-24-lon-heineken-silver-330ml",
        name:"Thùng 24 lon Bia Heineken Silver 330ml",
        title:"Thùng 24 Lon",
        packageItemCount:24,
        packageItemUnit:"Lon",
        productPrices:[{price:469000,sysPrice:469000,discountPercent:0,quantity:10,isCanBuy:true}]
      },
      {
        id:2,
        url:"/bia/6-lon-bia-heineken-silver-330ml",
        name:"6 lon bia Heineken Silver 330ml",
        title:"6 Lon",
        packageItemCount:6,
        packageItemUnit:"Lon",
        productPrices:[{price:122000,sysPrice:122000,discountPercent:0,quantity:10,isCanBuy:true}]
      },
      {
        id:3,
        url:"/bia/bia-heineken-silver-lon-330ml",
        name:"Bia Heineken Silver lon 330ml",
        title:"Lon",
        packageItemCount:1,
        packageItemUnit:"Lon",
        productPrices:[{price:21500,sysPrice:21500,discountPercent:0,quantity:10,isCanBuy:true}]
      }
    ]
  };
  const payload=productDetailPayload(input,"test",data);
  assert.equal(payload.schema_version,6);
  assert.equal(payload.product.price.current,469000);
  assert.equal(payload.product.comparison.pack_kind,"Thùng");
  assert.equal(payload.product.comparison.pack_quantity,24);
  assert.equal(payload.product.url,input);
  assert.deepEqual(payload.variants,[]);
  assert.deepEqual(payload.discovered_links,[]);
}

console.log("pack parser tests passed");
