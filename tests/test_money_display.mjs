import fs from "node:fs";
import assert from "node:assert/strict";

const app=fs.readFileSync("app.js","utf8");
const html=fs.readFileSync("index.html","utf8");

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
  const compactMatch=app.match(/function compactCartonDisplayName\(name,hierarchy\)\{[\s\S]*?\n\}/);
  assert.ok(capMatch&&compactMatch,"carton display helpers not found");
  const api=new Function(
    capMatch[0]+"\n"+compactMatch[0]+"\nreturn {compactCartonDisplayName};"
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
}

{
  const searchKeyMatch=app.match(/function searchKey\(value\)\{[\s\S]*?\n\}/);
  const searchDisplayNameMatch=app.match(/function searchDisplayName\(row\)\{[\s\S]*?\n\}/);
  const productSearchKeyMatch=app.match(/function productSearchKey\(row\)\{[\s\S]*?\n\}/);
  const matchesSearchMatch=app.match(/function matchesSearch\(row,query\)\{[\s\S]*?\n\}/);
  assert.ok(searchKeyMatch&&searchDisplayNameMatch&&productSearchKeyMatch&&matchesSearchMatch,"search helpers not found");
  const api=new Function(
    searchKeyMatch[0]+"\n"+searchDisplayNameMatch[0]+"\n"+productSearchKeyMatch[0]+"\n"+matchesSearchMatch[0]+
    "\nreturn {matchesSearch};"
  )();

  assert.equal(
    api.matchesSearch({name:"Tương ớt Chinsu chai 250g"},"tuong ot"),
    true
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
  assert.match(html,/<th>Thùng<\/th>/);
  assert.match(html,/<th>Giữa<\/th>/);
  assert.match(html,/<th>Lẻ<\/th>/);
  assert.match(html,/Giá nguồn \/ Thùng/);
  assert.match(html,/Giá nguồn \/ Giữa/);
  assert.match(html,/Giá nguồn \/ Lẻ/);
  assert.match(html,/Giá mình \/ Giữa/);
  assert.match(app,/sheet-my-middle/);
  assert.match(html,/<th>Nguồn<\/th>/);
  assert.match(app,/winmart\.vn/);
}

console.log("money and hierarchy UI tests passed");
