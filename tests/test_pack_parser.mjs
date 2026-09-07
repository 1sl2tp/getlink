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
  const p = parsePackStructure(
    "30 gói mì 3 Miền tôm chua cay 65g","Thùng 30 gói","",1,"Gói"
  );
  assert.equal(p.pack_kind,"Thùng");
  assert.equal(p.pack_quantity,30);
  assert.equal(p.pack_unit,"Gói");
}

{
  const p = parsePackStructure(
    "Combo 5 thùng 30 gói mì 3 Miền tôm chua cay 65g","Thùng 30 gói","",1,"Gói"
  );
  assert.equal(p.pack_kind,"Combo");
  assert.equal(p.pack_quantity,5);
  assert.equal(p.pack_unit,"Thùng");
}

{
  const p = parsePackStructure(
    "4 túi nước xả vải Downy hương nắng mai 3 lít","4 Túi","",4,"Túi"
  );
  assert.notEqual(p.pack_kind,"Thùng");
}

{
  const p = parsePackStructure(
    "4 túi nước xả vải Downy hương nắng mai 3 lít","Thùng 4 Túi","",4,"Túi"
  );
  assert.equal(p.pack_kind,"Thùng");
  assert.equal(p.pack_quantity,4);
  assert.equal(p.pack_unit,"Túi");
}

{
  const p = parsePackStructure(
    "2 thùng nước tăng lực Redbull Thái kèm vitamin 250ml","Thùng 24 Lon","",2,"Thùng"
  );
  assert.notEqual(p.pack_kind,"Thùng");
  assert.equal(p.pack_quantity,2);
  assert.equal(p.pack_unit,"Thùng");
}

{
  const input="https://bachhoaxanh.com/mi-an-lien/30-goi-mi-3-mien";
  const data={
    categoryName:"Mì ăn liền",
    boxBuys:[{
      id:10,
      url:"/mi-an-lien/30-goi-mi-3-mien",
      name:"30 gói mì 3 Miền tôm chua cay 65g",
      title:"30 Gói",
      packageItemCount:5,
      packageItemUnit:"Thùng",
      productPrices:[{price:470000,sysPrice:470000,discountPercent:0,quantity:5,isCanBuy:true}]
    }]
  };
  const payload=productDetailPayload(input,"test-price-unit",data);
  assert.equal(payload.schema_version,12);
  assert.notEqual(payload.product.comparison.pack_kind,"Thùng");
  assert.equal(payload.product.comparison.pack_quantity,30);
  assert.equal(payload.product.comparison.pack_unit,"Gói");
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
  const c = comparisonData({
    name:"Nước giặt OMO cửa trên hương Nhài trắng và Tuyết tùng túi 2.1kg",
    packagingText:"Túi",
    featureText:"",
    packCount:1,
    packUnit:"Túi",
    current:115000,
    sysPrice:115000,
    discount:0,
    promoText:"MUA 2 TÚI 199K"
  });
  assert.equal(c.quantity_offer_active,true);
  assert.equal(c.quantity_offer_min_packs,2);
  assert.equal(c.quantity_offer_total_price,199000);
  assert.equal(c.promo_pack_price,99500);
  assert.equal(c.promo_unit_price,99500);
  assert.equal(c.promotion_text,"MUA 2 TÚI 199K");
}

{
  const c = comparisonData({
    name:"10 bịch sữa dinh dưỡng tiệt trùng Vinamilk Happy Star 220ml",
    packagingText:"10 Bịch",
    featureText:"",
    packCount:10,
    packUnit:"Bịch",
    current:65000,
    sysPrice:86000,
    discount:24,
    promoText:"COMBO 10 BỊCH GIÁ 65.000Đ"
  });
  assert.equal(c.regular_pack_price,65000);
  assert.equal(c.regular_unit_price,6500);
  assert.equal(c.original_pack_price,86000);
  assert.equal(c.discount_active,true);
  assert.equal(c.quantity_offer_active,false);
  assert.equal(c.promotion_active,false);
  assert.equal(c.promo_pack_price,null);
  assert.equal(c.promotion_text,"");
}

{
  const c = comparisonData({
    name:"Thùng 24 lon Bia Heineken Silver 330ml",
    packagingText:"Thùng 24 Lon",
    featureText:"",
    packCount:24,
    packUnit:"Lon",
    current:469000,
    sysPrice:469000,
    discount:0,
    promoText:"MUA 2 TÚI 199K"
  });
  assert.equal(c.quantity_offer_active,false);
  assert.equal(c.promotion_active,false);
  assert.equal(c.promotion_text,"");
}

{
  const c = comparisonData({
    name:"Thùng 30 gói mì 3 Miền Gold chua cay Thái 75g",
    packagingText:"Thùng 30 Gói",
    featureText:"",
    packCount:30,
    packUnit:"Gói",
    current:147000,
    sysPrice:147000,
    discount:0,
    promoText:"216.000Đ 2 THÙNG (ONLINE)"
  });
  assert.equal(c.quantity_offer_active,true);
  assert.equal(c.quantity_offer_min_packs,2);
  assert.equal(c.quantity_offer_total_price,216000);
  assert.equal(c.quantity_offer_pack_price,108000);
  assert.equal(c.quantity_offer_unit_price,3600);
  assert.equal(c.promo_pack_price,108000);
  assert.equal(c.promo_unit_price,3600);
}

{
  const c = comparisonData({
    name:"4 túi nước xả vải Downy 3 lít",
    packagingText:"4 Túi",
    featureText:"",
    packCount:4,
    packUnit:"Túi",
    current:716000,
    sysPrice:716000,
    discount:0,
    promoText:"MUA 2 TÚI 199K"
  });
  assert.equal(c.quantity_offer_active,false);
  assert.equal(c.promotion_active,false);
}

{
  const c = comparisonData({
    name:"4 túi nước xả vải Downy 3 lít",
    packagingText:"4 Túi",
    featureText:"",
    packCount:4,
    packUnit:"Túi",
    current:716000,
    sysPrice:716000,
    discount:0,
    promoText:"MUA 8 TÚI 999K"
  });
  assert.equal(c.quantity_offer_active,true);
  assert.equal(c.quantity_offer_min_packs,2);
  assert.equal(c.quantity_offer_pack_price,499500);
  assert.equal(c.quantity_offer_unit_price,124875);
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
  assert.equal(payload.schema_version,12);
  assert.equal(payload.product.price.current,469000);
  assert.equal(payload.product.comparison.pack_kind,"Thùng");
  assert.equal(payload.product.comparison.pack_quantity,24);
  assert.equal(payload.product.url,input);
  assert.deepEqual(payload.variants,[]);
  assert.deepEqual(payload.discovered_links,[]);
}

console.log("pack parser tests passed");
