import fs from "node:fs";
import assert from "node:assert/strict";

const source = fs.readFileSync("worker/src/index.js","utf8")
  .replace(/\bexport\s+default\b/,"const __worker_default =");
const get = new Function(source + "\nreturn {parsePackStructure,comparisonData};");
const {parsePackStructure,comparisonData} = get();

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

console.log("pack parser tests passed");
