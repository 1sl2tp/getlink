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
  const hierarchyMatch=app.match(/function rowPackHierarchy\(row\)\{[\s\S]*?\n\}/);
  const cartonMatch=app.match(/function rowIsCarton\(row\)\{[\s\S]*?\n\}/);
  assert.ok(hierarchyMatch&&cartonMatch,"hierarchy helpers not found");
  const api=new Function(
    hierarchyMatch[0]+"\n"+cartonMatch[0]+
    "\nreturn {rowPackHierarchy,rowIsCarton};"
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
