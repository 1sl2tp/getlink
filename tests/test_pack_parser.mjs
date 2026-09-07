import fs from "node:fs";
import assert from "node:assert/strict";

const source = fs.readFileSync("worker/src/index.js","utf8")
  .replace(/\bexport\s+default\b/,"const __worker_default =");
const get = new Function(source + "\nreturn {parsePackStructure,comparisonData,productDetailPayload,categoryPayload,getlinkProductIdentity,getlinkCartonEvidence,packHierarchyData,apiProductToPayloadProduct};");
const {parsePackStructure,comparisonData,productDetailPayload,categoryPayload,getlinkProductIdentity,getlinkCartonEvidence,packHierarchyData,apiProductToPayloadProduct} = get();

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
  const p = parsePackStructure("Thùng 12 ly mì mini Doraemon hải sản chua ngọt 53g","","",1,"");
  assert.equal(p.pack_kind,"Thùng");
  assert.equal(p.pack_quantity,12);
  assert.equal(p.pack_unit,"Ly");
  assert.equal(p.size_value,53);
  assert.equal(p.size_unit,"g");
}

{
  const p = parsePackStructure("Mì trộn Cung Đình Kool vị sườn nướng tô 99g","","",1,"");
  assert.equal(p.pack_kind,"Tô");
  assert.equal(p.pack_quantity,1);
  assert.equal(p.pack_unit,"Tô");
  assert.equal(p.size_value,99);
  assert.equal(p.size_unit,"g");
}

{
  const p = parsePackStructure(
    "5 lốc Sữa dinh dưỡng pha sẵn NutiFood Grow Plus+ vani 180ml",
    "Can 180ml","",1,"Can"
  );
  assert.equal(p.pack_kind,"Cụm");
  assert.equal(p.pack_quantity,5);
  assert.equal(p.pack_unit,"Lốc");
}

{
  const p = parsePackStructure("Thùng 12 tô mì ăn liền 99g","","",1,"");
  assert.equal(p.pack_kind,"Thùng");
  assert.equal(p.pack_quantity,12);
  assert.equal(p.pack_unit,"Tô");
}

{
  const p = parsePackStructure("10 khoanh nhang muỗi Jumbo Vape M22 hương lavender 120g","","",1,"");
  assert.equal(p.pack_kind,"Cụm");
  assert.equal(p.pack_quantity,10);
  assert.equal(p.pack_unit,"Khoanh");
}

{
  const p = parsePackStructure(
    "Bột ngọt hạt lớn Ajinomoto gói 454g",
    "Lon 454g",
    "",
    1,
    "Lon"
  );
  assert.equal(p.pack_kind,"Gói");
  assert.equal(p.pack_quantity,1);
  assert.equal(p.pack_unit,"Gói");
}

{
  const p = parsePackStructure(
    "Cà phê MÊ Trang Robusta 500g",
    "Gói 500g",
    "",
    1,
    "Lon"
  );
  assert.equal(p.pack_kind,"Gói");
  assert.equal(p.pack_quantity,1);
  assert.equal(p.pack_unit,"Gói");
}

{
  const p = parsePackStructure(
    "Thùng 24 lon cà phê sữa Highlands 235ml",
    "Lon 235ml",
    "",
    1,
    "Lon"
  );
  assert.equal(p.pack_kind,"Thùng");
  assert.equal(p.pack_quantity,24);
  assert.equal(p.pack_unit,"Lon");
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
  assert.throws(
    ()=>productDetailPayload(input,"test-price-unit",data),
    /bhx_detail_filtered_or_empty/
  );
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
  const c = comparisonData({
    name:"Lốc 4 hộp sữa tươi tiệt trùng socola TH true MILK 180ml",
    packagingText:"Lốc 4 Hộp",
    featureText:"",
    packCount:4,
    packUnit:"Hộp",
    current:40500,
    sysPrice:40500,
    discount:0,
    promoText:"GIẢM 5.000Đ TỪ 2 LỐC. GIẢM 20.000Đ 5 LỐC"
  });
  assert.equal(c.pack_kind,"Lốc");
  assert.equal(c.pack_quantity,4);
  assert.equal(c.pack_unit,"Hộp");
  assert.equal(c.quantity_offer_active,true);
  assert.equal(c.quantity_offer_min_packs,5);
  assert.equal(c.quantity_offer_total_price,182500);
  assert.equal(c.quantity_offer_pack_price,36500);
  assert.equal(c.quantity_offer_unit_price,9125);
  assert.equal(c.promo_pack_price,36500);
  assert.equal(c.promo_unit_price,9125);
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
  assert.equal(payload.schema_version,19);
  assert.equal(payload.product.price.current,469000);
  assert.equal(payload.product.comparison.pack_kind,"Thùng");
  assert.equal(payload.product.comparison.pack_quantity,24);
  assert.equal(payload.product.url,input);
  assert.deepEqual(payload.variants,[]);
  assert.deepEqual(payload.discovered_links,[]);
}

console.log("pack parser tests passed");


{
  const identity = getlinkProductIdentity(
    "24 lon cà phê sữa Highlands 235ml",
    "https://www.bachhoaxanh.com/ca-phe-lon/thung-24-lon-ca-phe-sua-highlands-235ml",
    "Lon 235ml"
  );
  assert.equal(identity.keep,true);
  assert.equal(identity.authoritativeCarton,true);
  assert.equal(identity.name,"Thùng 24 lon cà phê sữa Highlands 235ml");
  assert.match(identity.packaging,/^Thùng 24 Lon/);
}

{
  const raw={
    url:"/ca-phe-lon/thung-24-lon-ca-phe-sua-highlands-235ml",
    fullName:"24 lon cà phê sữa Highlands 235ml",
    canonical:"Lon 235ml",
    unit:"Lon",
    packageItemCount:24,
    packageItemUnit:"Lon",
    avatar:"https://example.com/highlands.jpg",
    brandName:"Highlands",
    category:{name:"Cà phê lon"},
    productPrices:[{price:332000,sysPrice:332000,discountPercent:0}]
  };
  const p=apiProductToPayloadProduct(raw);
  assert.ok(p);
  assert.equal(p.name,"Thùng 24 lon cà phê sữa Highlands 235ml");
  assert.equal(p.comparison.pack_kind,"Thùng");
  assert.equal(p.comparison.pack_quantity,24);
  assert.equal(p.comparison.pack_unit,"Lon");
  assert.equal(p.comparison.regular_unit_price,13833);
}

{
  const blocked=[
    ["2 túi nước giặt OMO 2.1kg","https://www.bachhoaxanh.com/nuoc-giat/2-tui-omo","Túi"],
    ["Combo 6 lon bia Sài Gòn","https://www.bachhoaxanh.com/bia/combo-6-lon-bia","Lon"],
    ["2 thùng nước ngọt Redbull","https://www.bachhoaxanh.com/nuoc-ngot/2-thung-redbull","Thùng"],
    ["24 lon bia A và 24 lon bia B","https://www.bachhoaxanh.com/bia/thung-24-lon-a-va-b","Thùng 24 Lon"]
  ];
  for(const [name,url,packaging] of blocked){
    const identity=getlinkProductIdentity(name,url,packaging);
    assert.equal(identity.keep,false,name);
  }
}

{
  const payload=categoryPayload(
    "https://www.bachhoaxanh.com/ca-phe-lon",
    "test-ingestion-gate",
    {
      products:[
        {
          url:"/ca-phe-lon/thung-24-lon-ca-phe-sua-highlands-235ml",
          fullName:"24 lon cà phê sữa Highlands 235ml",
          canonical:"Lon 235ml",
          unit:"Lon",
          packageItemCount:24,
          packageItemUnit:"Lon",
          avatar:"https://example.com/highlands.jpg",
          brandName:"Highlands",
          category:{name:"Cà phê lon"},
          productPrices:[{price:332000,sysPrice:332000}]
        },
        {
          url:"/ca-phe-lon/2-lon-ca-phe-demo",
          fullName:"2 lon cà phê demo 235ml",
          canonical:"Lon 235ml",
          unit:"Lon",
          packageItemCount:2,
          packageItemUnit:"Lon",
          avatar:"https://example.com/demo.jpg",
          brandName:"Demo",
          category:{name:"Cà phê lon"},
          productPrices:[{price:30000,sysPrice:30000}]
        }
      ]
    }
  );
  assert.equal(payload.products.length,1);
  assert.equal(payload.products[0].comparison.pack_kind,"Thùng");
  assert.equal(payload.filter_summary.source_count,2);
  assert.equal(payload.filter_summary.kept_count,1);
  assert.equal(payload.filter_summary.filtered_count,1);
}


{
  const h=packHierarchyData(
    "24 lon cà phê sữa Highlands 235ml",
    "https://bachhoaxanh.com/ca-phe-lon/thung-24-lon-ca-phe-sua-highlands-235ml",
    "Lon 235ml",
    24,
    "Lon"
  );
  assert.equal(h.label1,"Thùng");
  assert.equal(h.qty1,1);
  assert.equal(h.label2,"Lon");
  assert.equal(h.qty2,24);
  assert.equal(h.label3,"");
  assert.equal(h.qty3,0);
  assert.equal(h.evidence,"url");
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
  assert.equal(h.label2,"Lốc");
  assert.equal(h.qty2,12);
  assert.equal(h.label3,"Hộp");
  assert.equal(h.qty3,4);
  assert.equal(h.evidence,"name");
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
  assert.equal(h.label2,"Lon");
  assert.equal(h.qty2,28);
}

{
  const h=packHierarchyData(
    "Bia Heineken Silver lon 330ml",
    "https://bachhoaxanh.com/bia/bia-heineken-silver-lon-330ml",
    "Lon",
    1,
    "Lon"
  );
  assert.equal(h.label1,"");
  assert.equal(h.label2,"");
  assert.equal(h.label3,"");
}

{
  const h=packHierarchyData(
    "6 lon bia Heineken Silver 330ml",
    "https://bachhoaxanh.com/bia/thung-6-lon-bia-heineken-silver-330ml",
    "Lon",
    6,
    "Lon"
  );
  const c=comparisonData({
    name:"Thùng 6 lon bia Heineken Silver 330ml",
    url:"https://bachhoaxanh.com/bia/thung-6-lon-bia-heineken-silver-330ml",
    packagingText:"Thùng 6 Lon",
    featureText:"",
    packCount:6,
    packUnit:"Lon",
    current:126000,
    sysPrice:126000,
    discount:0,
    promoText:"",
    hierarchy:h
  });
  assert.equal(c.pack_kind,"Thùng");
  assert.equal(c.pack_quantity,6);
  assert.equal(c.pack_unit,"Lon");
  assert.equal(c.regular_unit_price,21000);
}


{
  const payload=categoryPayload(
    "https://www.bachhoaxanh.com/bia",
    "test-duplicate-canonical-name",
    {
      products:[
        {
          url:"/bia/thung-24-lon-bia-heineken-silver-330ml",
          name:"Thùng 24 lon bia Heineken Silver 330ml",
          fullName:"Thùng 24 lon Bia Heineken Silver 330ml",
          canonical:"24 lon 330ml",
          unit:"Lon",
          packageItemCount:null,
          packageItemUnit:null,
          avatar:"https://example.com/heineken-carton.jpg",
          brandName:"Heineken",
          category:{name:"Bia, nước có cồn"},
          productPrices:[{price:469000,sysPrice:469000}]
        },
        {
          url:"https://www.bachhoaxanh.com/bia/thung-24-lon-bia-heineken-silver-330ml",
          name:"HEINEKEN KÈM TRỨNG 10K",
          fullName:null,
          canonical:null,
          unit:null,
          packageItemCount:null,
          packageItemUnit:null,
          avatar:"",
          brandName:null,
          category:{name:"Bia, nước có cồn"},
          productPrices:null
        }
      ]
    }
  );

  assert.equal(payload.products.length,1);
  assert.equal(payload.filter_summary.source_count,2);
  assert.equal(payload.filter_summary.candidate_count,2);
  assert.equal(payload.filter_summary.duplicate_count,1);
  assert.equal(payload.products[0].name,"Thùng 24 lon Bia Heineken Silver 330ml");
  assert.equal(payload.products[0].hierarchy.label1,"Thùng");
  assert.equal(payload.products[0].hierarchy.label2,"Lon");
  assert.equal(payload.products[0].hierarchy.qty2,24);
  assert.equal(payload.products[0].price.current,469000);
}
