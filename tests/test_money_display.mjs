import fs from "node:fs";
import assert from "node:assert/strict";

const app=fs.readFileSync("app.js","utf8");
const html=fs.readFileSync("index.html","utf8");
const css=fs.readFileSync("style.css","utf8");

const moneyMatch=app.match(/function money\(v\)\{[\s\S]*?\n\}/);
assert.ok(moneyMatch,"money() not found");
const money=new Function(moneyMatch[0]+"\nreturn money;")();

assert.equal(money(15300),"15.5");
assert.equal(money(15490),"15.5");
assert.equal(money(61500),"61.5");
assert.equal(money(88100),"88");
assert.equal(money(88300),"88.5");
assert.equal(money(6450),"6.5");
assert.equal(money(2042),"2");
assert.equal(money(1750),"2");
assert.equal(money(99500),"99.5");
assert.equal(money(0),"—");

{
  const winmartMatch=app.match(/function winmartDisplayPack\(row\)\{[\s\S]*?\n\}/);
  const hierarchyMatch=app.match(/function rowPackHierarchy\(row\)\{[\s\S]*?\n\}/);
  const cartonMatch=app.match(/function rowIsCarton\(row\)\{[\s\S]*?\n\}/);
  assert.ok(winmartMatch&&hierarchyMatch&&cartonMatch,"hierarchy helpers not found");
  const api=new Function(
    "function isWinmartRow(row){return String(row&&row.source||'').toLowerCase()==='winmart';}\n"+
    winmartMatch[0]+"\n"+hierarchyMatch[0]+"\n"+cartonMatch[0]+
    "\nreturn {winmartDisplayPack,rowPackHierarchy,rowIsCarton};"
  )();

  const row={
    pack_label_1:"Thùng",
    pack_qty_1:1,
    pack_label_2:"",
    pack_qty_2:0,
    pack_label_3:"Lon",
    pack_qty_3:24,
    pack_evidence:"url",
    hierarchy_locked:1
  };
  assert.equal(api.rowIsCarton(row),true);
  assert.deepEqual(api.rowPackHierarchy(row),{
    label1:"Thùng",qty1:1,
    label2:"",qty2:0,
    label3:"Lon",qty3:24,
    evidence:"url",locked:true
  });

  assert.deepEqual(
    api.winmartDisplayPack({source:"WinMart",packaging:"THÙNG 24"}),
    {kind:"carton",label:"THÙNG 24"}
  );
  assert.deepEqual(
    api.winmartDisplayPack({source:"WinMart",packaging:"Gói 6"}),
    {kind:"middle",label:"Gói 6"}
  );
  assert.deepEqual(
    api.winmartDisplayPack({source:"WinMart",packaging:"Hộp"}),
    {kind:"leaf",label:"Hộp"}
  );
  assert.deepEqual(
    api.winmartDisplayPack({source:"WinMart",packaging:"Miếng"}),
    {kind:"leaf",label:"Miếng"}
  );
}

{
  const capMatch=app.match(/function capitalizeDisplayName\(value\)\{[\s\S]*?\n\}/);
  const stripMatch=app.match(/function stripCartonPackPhrase\(value\)\{[\s\S]*?\n\}/);
  const compactMatch=app.match(/function compactCartonDisplayName\(name,hierarchy\)\{[\s\S]*?\n\}/);
  assert.ok(capMatch&&stripMatch&&compactMatch,"carton display helpers not found");
  const api=new Function(
    capMatch[0]+"\n"+stripMatch[0]+"\n"+compactMatch[0]+"\nreturn {compactCartonDisplayName};"
  )();
  const h={label1:"Thùng"};
  assert.equal(
    api.compactCartonDisplayName("Thùng 24 gói mì Hảo Hảo 75g",h),
    "Mì Hảo Hảo 75g"
  );
  assert.equal(
    api.compactCartonDisplayName("Bia 333 Export thùng 24 lon x 330ml",h),
    "Bia 333 Export 330ml"
  );
  assert.equal(
    api.compactCartonDisplayName("Khay 24 lon Strongbow vị táo 320ml",h),
    "Strongbow vị táo 320ml"
  );
  assert.equal(
    api.compactCartonDisplayName("Thùng 24 chia nước ép cam Twister 455ml",h),
    "Nước ép cam Twister 455ml"
  );
  assert.equal(
    api.compactCartonDisplayName("Thùng 24 + 4 lon Bia Budweiser 250ml",h),
    "Bia Budweiser 250ml"
  );
  assert.equal(
    api.compactCartonDisplayName("Thùng 24 bi\u0323ch sữa dinh dưỡng Dutch Lady 180ml",h),
    "Sữa dinh dưỡng Dutch Lady 180ml"
  );
  assert.equal(
    api.compactCartonDisplayName("Thùng 24 Pepsi không đường 330ml",h),
    "Pepsi không đường 330ml"
  );
  assert.equal(
    api.compactCartonDisplayName("Thùng 12 lốc nước ngọt Pepsi 330ml",h),
    "Nước ngọt Pepsi 330ml"
  );
  assert.equal(
    api.compactCartonDisplayName("Thùng 12 lốc 4 hộp sữa Demo 180ml",h),
    "Sữa Demo 180ml"
  );

  const middle={label1:"",label2:"Lốc",label3:""};
  assert.equal(
    api.compactCartonDisplayName("Lốc 6 Pepsi không đường 330ml",middle),
    "Pepsi không đường 330ml"
  );
  assert.equal(
    api.compactCartonDisplayName("Lốc 6 lon Pepsi không đường 330ml",middle),
    "Pepsi không đường 330ml"
  );

  const numberedLeafWordAsMiddle={label1:"",label2:"Gói 6",label3:""};
  assert.equal(
    api.compactCartonDisplayName("Gói 6 khăn giấy bỏ túi",numberedLeafWordAsMiddle),
    "Khăn giấy bỏ túi"
  );

  const leafOnly={label1:"",label2:"",label3:"Gói"};
  assert.equal(
    api.compactCartonDisplayName("Gói 65g mì 3 Miền tôm chua cay",leafOnly),
    "Gói 65g mì 3 Miền tôm chua cay"
  );
}

{
  const moneyMatch2=app.match(/function money\(v\)\{[\s\S]*?\n\}/);
  const cartonCardMatch=app.match(/function rowCartonCardMeta\(row,packPrice\)\{[\s\S]*?\n\}/);
  assert.ok(moneyMatch2&&cartonCardMatch,"carton card meta helper not found");
  const api=new Function(
    moneyMatch2[0]+"\n"+
    "function rowPackHierarchy(row){return row.h;}\n"+
    "function rowPrimaryQc(){return '—';}\n"+
    cartonCardMatch[0]+
    "\nreturn {rowCartonCardMeta};"
  )();
  assert.deepEqual(
    api.rowCartonCardMeta({h:{label1:"Thùng",qty1:1,label2:"",qty2:0,label3:"Hộp",qty3:24}},240000),
    {pack:"24 hộp × 10",unitPrice:""}
  );
  assert.deepEqual(
    api.rowCartonCardMeta({h:{label1:"Thùng",qty1:1,label2:"",qty2:0,label3:"",qty3:0}},240000),
    {pack:"Thùng",unitPrice:""}
  );
}

{
  const searchKeyMatch=app.match(/function searchKey\(value\)\{[\s\S]*?\n\}/);
  const stripCartonMatch=app.match(/function stripCartonPackPhrase\(value\)\{[\s\S]*?\n\}/);
  const searchDisplayNameMatch=app.match(/function searchDisplayName\(row\)\{[\s\S]*?\n\}/);
  const productSearchKeyMatch=app.match(/function productSearchKey\(row\)\{[\s\S]*?\n\}/);
  const matchesSearchMatch=app.match(/function matchesSearch\(row,query\)\{[\s\S]*?\n\}/);
  assert.ok(searchKeyMatch&&stripCartonMatch&&searchDisplayNameMatch&&productSearchKeyMatch&&matchesSearchMatch,"search helpers not found");
  const api=new Function(
    searchKeyMatch[0]+"\n"+stripCartonMatch[0]+"\n"+searchDisplayNameMatch[0]+"\n"+productSearchKeyMatch[0]+"\n"+matchesSearchMatch[0]+
    "\nreturn {matchesSearch};"
  )();

  assert.equal(
    api.matchesSearch({name:"Tương ớt Chinsu chai 250g"},"tuong ot"),
    true
  );
  assert.equal(
    api.matchesSearch({name:"Tương ớt Chinsu chai 250g"},"tuong o"),
    true
  );
  assert.equal(
    api.matchesSearch({name:"Sữa đậu nành Fami Canxi 200ml"},"fami c"),
    true
  );
  assert.equal(
    api.matchesSearch({name:"Mì Hảo Hảo tôm chua cay"},"hao h"),
    true
  );
  assert.equal(
    api.matchesSearch({name:"Sữa đậu nành Fami nguyên vị 200ml"},"fami c"),
    false
  );
  assert.equal(
    api.matchesSearch({name:"Mì tương đen Bắc Kinh Ottogi gói 83g"},"tuong ot"),
    false
  );
  assert.equal(
    api.matchesSearch({name:"Dầu hào Maggi chai 350g",source_name:"Dầu hào Maggi chai 350g",canonical_url:"https://example.com/dau-hao-maggi"},"hao hao"),
    false
  );
  assert.equal(
    api.matchesSearch({name:"Mì Hảo Hảo tôm chua cay"},"hao hao"),
    true
  );
  assert.equal(
    api.matchesSearch({name:"Nước khoáng Vĩnh Hảo 500ml",brand_name:"Vĩnh Hảo"},"hao hao"),
    false
  );
  assert.equal(
    api.matchesSearch({name:"Sữa đặc có đường Hoàn Hảo 380g",brand_name:"Hoàn Hảo"},"hao hao"),
    false
  );
  const haoHao={name:"Mì tôm Hảo Hảo 30 gói",brand_name:"Hảo Hảo",packaging:"Thùng"};
  assert.equal(api.matchesSearch(haoHao,"mi hao"),true);
  assert.equal(api.matchesSearch(haoHao,"tom hao"),true);
  assert.equal(api.matchesSearch(haoHao,"hao 30"),true);
  assert.equal(
    api.matchesSearch({name:"Nước khoáng Vĩnh Hảo 500ml",brand_name:"Hảo Hảo"},"hao hao"),
    false
  );
  assert.equal(
    api.matchesSearch({
      name:"Bia 333 Export thùng 24 lon x 330ml",
      packaging:"Thùng",
      pack_label_1:"Thùng"
    },"thung"),
    false
  );
  assert.equal(
    api.matchesSearch({
      name:"Bia 333 Export thùng 24 lon x 330ml",
      packaging:"Thùng",
      pack_label_1:"Thùng"
    },"bia 333"),
    true
  );
}

{
  // Thùng/Lẻ is a global shopping-mode selection and must survive
  // category and brand navigation. Search already only changes result rows.
  const categoryHandler=app.match(/\$\("#categoryTabs"\)\.addEventListener\("click",[\s\S]*?\n\}\);/);
  const brandHandler=app.match(/\$\("#brandTabs"\)\.addEventListener\("click",[\s\S]*?\n\}\);/);
  const packRenderer=app.match(/function renderPackTabs\(\)\{[\s\S]*?\n\}/);
  assert.ok(categoryHandler&&brandHandler&&packRenderer,"pack-navigation handlers not found");
  assert.equal(categoryHandler[0].includes('activePackKind=""'),false);
  assert.equal(brandHandler[0].includes('activePackKind=""'),false);
  assert.equal(packRenderer[0].includes('selectedCount===0'),false);
}

{
  const forbidden=[
    "function inferSheetPack(",
    "function simpleRowPrice(",
    "function suppressRedundantMultiPacks(",
    "function retailDisplayName(",
    "function rowUrlIsCarton(",
    "function rowCartonStartText("
  ];
  for(const token of forbidden){
    assert.equal(app.includes(token),false,token+" must stay deleted");
  }
}

{
  assert.match(html,/xls-desktop-only">Thùng<\/span>/);
  assert.match(html,/<th>Giữa<\/th>/);
  assert.match(html,/<th>Lẻ<\/th>/);
  assert.match(html,/Giá nguồn \/ Thùng/);
  assert.match(html,/Giá nguồn \/ Giữa/);
  assert.match(html,/Giá nguồn \/ Lẻ/);
  assert.match(html,/Giá mình \/ Giữa/);
  assert.match(app,/sheet-my-middle/);
  assert.match(html,/id="tableSourceSort"/);
  assert.match(html,/>Nguồn<\/span>/);
  assert.match(app,/winmart\.vn/);
}


{
  assert.match(app,/const AUTO_UPDATE_CHECK_MS=30000/);
  assert.match(app,/function checkUiVersion\(\)/);
  assert.match(app,/cache:"no-store"/);
  assert.match(app,/visibilitychange/);
  assert.match(app,/location\.replace\(next\.toString\(\)\)/);
  assert.match(app,/autoUpdateEditingActive\(\)/);
  assert.match(app,/__getlink_v/);
}


{
  const packRenderer=app.match(/function renderPackTabs\(\)\{[\s\S]*?\n\}/);
  const sourceRenderer=app.match(/function renderSourceTabs\(\)\{[\s\S]*?\n\}/);
  const packHandler=app.match(/\$\("#packTabs"\)\.addEventListener\("click",[\s\S]*?\n\}\);/);
  const sourceHandler=app.match(/\$\("#sourceTabs"\)\.addEventListener\("click",[\s\S]*?\n\}\);/);
  assert.ok(packRenderer&&sourceRenderer&&packHandler&&sourceHandler,"source-menu helpers not found");
  assert.equal(packRenderer[0].includes(">Cả hai <small>"),false);
  assert.match(sourceRenderer[0],/>3 nguồn<\/span>/);
  assert.match(sourceHandler[0],/activeSourceFilter=chip\.dataset\.source\|\|""/);
  assert.match(html,/nav-source-block/);
  assert.match(html,/id="sourceTabs" class="source-tabs nav-source-tabs"/);
  assert.match(html,/Quy cách:<\/span>/);
  assert.equal(html.includes('filter-block-source'),false);
}


{
  assert.equal(html.includes(">☰<"),false);
  assert.equal(html.includes(">▦<"),false);
  assert.equal(html.includes(">☷<"),false);
  assert.equal(html.includes(">×<"),false);
  assert.match(html,/class="ui-icon"/);
  assert.match(app,/function watchIconSvg\(active\)/);
  assert.match(css,/Visual geometry v1/);
  assert.match(css,/aspect-ratio:4 \/ 3!important/);
  assert.match(css,/\.workspace-nav \.category-tabs,[\s\S]*?flex:1 1 auto!important/);
  assert.match(css,/\.grid-watch-button \.ui-icon\{[\s\S]*?width:15px!important/);
  assert.match(css,/Price color is semantic, not source branding/);
  assert.match(css,/max-width:88%!important/);
  assert.match(css,/max-height:88%!important/);
  assert.match(css,/max-width:86%!important/);
  assert.match(css,/object-position:center center!important/);
}


{
  const categoryMatch=app.match(/function displayCategoryLabel\(value\)\{[\s\S]*?\n\}/);
  assert.ok(categoryMatch,"displayCategoryLabel() not found");
  const displayCategoryLabel=new Function(
    "function searchKey(value){return String(value||'').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').replace(/đ/gi,'d').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}\n"+
    "const CATEGORY_DISPLAY_LABELS=new Map([['cham soc ca nhan','Chăm sóc cá nhân'],['banh keo cac loai','Bánh kẹo các loại'],['do uong cac loai','Đồ uống các loại'],['gao mi bun','Gạo, mì, bún'],['sua cac loai','Sữa các loại'],['nguyen lieu gia vi','Nguyên liệu, gia vị'],['cham soc nha cua','Chăm sóc nhà cửa'],['xuc xich do hop','Xúc xích, đồ hộp'],['khan giay ve sinh','Khăn giấy, vệ sinh']]);\n"+
    categoryMatch[0]+"\nreturn displayCategoryLabel;"
  )();
  assert.equal(displayCategoryLabel("Do Uong Cac Loai I.66"),"Đồ uống các loại");
  assert.equal(displayCategoryLabel("Cham Soc Ca Nhan I.68"),"Chăm sóc cá nhân");
  assert.equal(displayCategoryLabel("Sữa tươi"),"Sữa tươi");

  assert.match(html,/id="webPriceNote" class="price-note"/);
  assert.match(app,/function detailPriceContext\(p,cmp,totalPrice,unitPrice\)/);
  assert.match(app,/webPriceNote/);
  assert.match(css,/Catalog canonical owner v2/);
  assert.match(css,/grid-template-columns:minmax\(0,1fr\) max-content!important/);
  assert.match(css,/max-width:64%!important/);
  assert.equal(css.includes("Carton footer v3:"),false);
  assert.equal(css.includes("Carton footer v4:"),false);
  assert.equal(css.includes("Carton footer v5:"),false);
}


{
  assert.match(html,/id="tableSourceSort"/);
  assert.match(html,/aria-sort="none"/);
  assert.match(html,/xls-compact-only">Quy cách/);
  assert.match(html,/xls-compact-only">Giá/);
  assert.match(app,/function tableCompactQc\(levels\)/);
  assert.match(app,/function tablePrimarySourcePrice\(levels\)/);
  assert.match(app,/function sortTableProducts\(products\)/);
  assert.match(app,/tableSourceSort=tableSourceSort==="asc"\?"desc":"asc"/);
  assert.match(css,/Compact table v2/);
  assert.match(css,/container-type:inline-size/);
  assert.match(css,/@container \(max-width:980px\)/);
  assert.match(css,/th:nth-child\(2\),[\s\S]*?width:54px!important/);
  assert.match(css,/th:nth-child\(3\),[\s\S]*?width:112px!important/);
  assert.match(css,/th:nth-child\(6\),[\s\S]*?width:76px!important/);
  assert.match(css,/@container \(max-width:520px\)/);
}

console.log("money and hierarchy UI tests passed");
