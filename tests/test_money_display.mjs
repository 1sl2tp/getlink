import fs from "node:fs";
import assert from "node:assert/strict";

const source=fs.readFileSync("app.js","utf8");
const match=source.match(/function money\(v\)\{[\s\S]*?\n\}/);
assert.ok(match,"money() not found");
const money=new Function(match[0]+"\nreturn money;")();

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
  const app=fs.readFileSync("app.js","utf8");
  const searchMatch=app.match(/function searchKey\(value\)\{[\s\S]*?\n\}/);
  const cartonMatch=app.match(/function rowCartonStartText\(row\)\{[\s\S]*?\n\}/);
  assert.ok(searchMatch&&cartonMatch,"carton safety helpers not found");
  const rowCartonStartText=new Function(
    searchMatch[0]+"\n"+cartonMatch[0]+"\nreturn rowCartonStartText;"
  )();
  assert.equal(
    rowCartonStartText({name:"Thùng 24 lon cà phê sữa Highlands 235ml"}),
    "thung 24 lon ca phe sua highlands 235ml"
  );
  assert.equal(
    rowCartonStartText({
      name:"Cà phê sữa Highlands 235ml",
      source_name:"Thùng 24 lon cà phê sữa Highlands 235ml"
    }),
    "thung 24 lon ca phe sua highlands 235ml"
  );
  assert.equal(
    rowCartonStartText({name:"6 lon cà phê sữa Highlands 235ml"}),
    ""
  );
}


{
  const app=fs.readFileSync("app.js","utf8");
  const displayMatch=app.match(/function retailDisplayName\(row,simple\)\{[\s\S]*?\n\}/);
  assert.ok(displayMatch,"retailDisplayName() not found");
  const retailDisplayName=new Function(displayMatch[0]+"\nreturn retailDisplayName;")();

  const simple={rawName:"Combo 6 lon bia Sài Gòn Special Sleek 330ml",hasCarton:false,mixedBundle:false,displayQty:6,displayUnit:"Lon"};
  assert.equal(retailDisplayName({},simple),"bia Sài Gòn Special Sleek 330ml");

  assert.equal(retailDisplayName({},{
    rawName:"5 lốc Sữa dinh dưỡng pha sẵn NutiFood Grow Plus+ vani 180ml",
    hasCarton:false,mixedBundle:false,displayQty:5,displayUnit:"Lốc"
  }),"Sữa dinh dưỡng pha sẵn NutiFood Grow Plus+ vani 180ml");

  assert.equal(retailDisplayName({},{
    rawName:"10 khoanh nhang muỗi Jumbo Vape M22 hương lavender 120g",
    hasCarton:false,mixedBundle:false,displayQty:10,displayUnit:"Khoanh"
  }),"nhang muỗi Jumbo Vape M22 hương lavender 120g");

  assert.equal(retailDisplayName({},{
    rawName:"Thùng 24 lon cà phê sữa Highlands 235ml",
    hasCarton:true,mixedBundle:false,displayQty:24,displayUnit:"Lon"
  }),"Thùng 24 lon cà phê sữa Highlands 235ml");

  assert.equal(retailDisplayName({},{
    rawName:"Combo 24 lon A và 24 lon B",
    hasCarton:false,mixedBundle:true,displayQty:0,displayUnit:""
  }),"Combo 24 lon A và 24 lon B");
}


{
  const app=fs.readFileSync("app.js","utf8");
  const normalizeMatch=app.match(/function sheetNormalizeUnit\(value\)\{[\s\S]*?\n\}/);
  const inferMatch=app.match(/function inferSheetPack\(row\)\{[\s\S]*?\n\}/);
  assert.ok(normalizeMatch&&inferMatch,"pack priority helpers not found");
  const inferSheetPack=new Function(
    normalizeMatch[0]+"\n"+inferMatch[0]+"\nreturn inferSheetPack;"
  )();

  assert.deepEqual(
    inferSheetPack({
      name:"Bột ngọt hạt lớn Ajinomoto gói 454g",
      packaging:"Lon 454g",
      pack_quantity:1,
      pack_unit:"Lon"
    }),
    {qty:1,unit:"Gói",kind:"Gói",sizeValue:454,sizeUnit:"g"}
  );

  assert.deepEqual(
    inferSheetPack({
      name:"Cà phê MÊ Trang Robusta 500g",
      packaging:"Gói 500g",
      pack_quantity:1,
      pack_unit:"Lon"
    }),
    {qty:1,unit:"Gói",kind:"Gói",sizeValue:500,sizeUnit:"g"}
  );

  assert.deepEqual(
    inferSheetPack({
      name:"Thùng 24 lon cà phê sữa Highlands 235ml",
      packaging:"Lon 235ml",
      pack_quantity:1,
      pack_unit:"Lon"
    }),
    {qty:24,unit:"Lon",kind:"Thùng",sizeValue:235,sizeUnit:"ml"}
  );
}

console.log("money display tests passed");
