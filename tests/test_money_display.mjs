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

console.log("money display tests passed");
