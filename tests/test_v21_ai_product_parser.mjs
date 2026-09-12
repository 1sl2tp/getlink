import assert from 'node:assert/strict';
import { parseCustomerTextDetailed } from '../supabase/functions/v21-ai-product-parser/parser-core.mjs';

function lines(text){
  return parseCustomerTextDetailed(text).lines.map(row=>row.line);
}

// Existing locked input-only behavior.
assert.deepEqual(lines('sim 1 2'),['2 Sim 1']);
assert.deepEqual(lines('2 sim 1'),['2 Sim 1']);
assert.deepEqual(lines('sim den 1 3'),['3 Sim den 1']);
assert.deepEqual(lines('cung 1'),['1 Cung']);
assert.deepEqual(lines('1 cung'),['1 Cung']);
assert.deepEqual(lines('1 cung, 1 mem, 1 det, 1 melon, 1 sg bam'),[
  '1 Cung','1 Mem','1 Det','1 Melon','1 Sg bam',
]);
assert.deepEqual(lines('cung 1 / det 1 / mem 1'),['1 Cung','1 Det','1 Mem']);

// No delimiter means never invent multiple products.
assert.deepEqual(lines('cung 1 det 1'),[]);
assert.deepEqual(lines('cung 1 det 1 mem 1'),[]);

// A colon/equation makes the whole message unsupported for this input-only stage;
// do not parse orphan children after the separator.
assert.deepEqual(lines('sim: 1 den, 2 xanh'),[]);
assert.deepEqual(lines('cung = cung, 2 sim'),[]);

// If one explicitly separated segment is invalid, do not return only the remaining fragments.
assert.deepEqual(lines('cung, 2 sim'),[]);
assert.deepEqual(lines('2 sim / mem'),[]);

// Comma is a product separator unless it is really a decimal comma.
assert.deepEqual(lines('1 cung,1 mem'),['1 Cung','1 Mem']);
assert.deepEqual(lines('1,5 sim'),['1.5 Sim']);
assert.deepEqual(lines('sim 1,5'),['1.5 Sim']);

// Numeric-leading brands/names are explicit exceptions sourced from confirmed product data.
for(const [input,expected] of [
  ['555 det 2',['2 555 det']],
  ['333 lon 2',['2 333 lon']],
  ['3 mien 2',['2 3 mien']],
  ['3 miền 2',['2 3 miền']],
  ['7 up 2',['2 7 up']],
  ['7up 2',['2 7up']],
  ['1664 blanc 2',['2 1664 blanc']],
  ['584 nha trang 2',['2 584 nha trang']],
  ['3k 2',['2 3k']],
  ['3 co gai 2',['2 3 co gai']],
  ['3 cô gái 2',['2 3 cô gái']],
  ['3 con tom 2',['2 3 con tom']],
  ['3 con tôm 2',['2 3 con tôm']],
  ['7days 2',['2 7days']],
  ['7 days 2',['2 7 days']],
  ['888 2',['2 888']],
  ['2 chew 3',['3 2 chew']],
  ['2 555 det',['2 555 det']],
  ['2 333 lon',['2 333 lon']],
  ['2 3 mien',['2 3 mien']],
  ['2 7 up',['2 7 up']],
  ['2 1664 blanc',['2 1664 blanc']],
  ['2 584 nha trang',['2 584 nha trang']],
  ['2 3k',['2 3k']],
  ['2 3 co gai',['2 3 co gai']],
  ['2 3 con tom',['2 3 con tom']],
  ['2 7days',['2 7days']],
  ['2 888',['2 888']],
  ['3 2 chew',['3 2 chew']],
]) assert.deepEqual(lines(input),expected,input);

// A numeric brand/name without a quantity must not be mistaken for quantity + product.
for(const text of [
  '555 det','333 lon','3 mien','7 up','7up','1664 blanc','584 nha trang',
  '3k','3 co gai','3 con tom','7days','7 days','888','2 chew',
]) assert.deepEqual(lines(text),[],text);

// Numeric source IDs seen in bad/raw brand fields are NOT parsing exceptions.
for(const text of ['16731','16625','16370']) assert.deepEqual(lines(text),[],text);

// Current unit syntax stays locked for now; no carton/tree conversion happens here.
assert.deepEqual(lines('2 thùng sim'),['2 Sim']);
assert.deepEqual(lines('2 th sim'),['2 Sim']);
assert.deepEqual(lines('2t sim'),['2 Sim']);
assert.deepEqual(lines('sim 2 th'),['2 Sim']);

for(const text of [
  'sim 1 2',
  'cung 1',
  '1 cung',
  '1 cung, 1 mem, 1 det, 1 melon, 1 sg bam',
]){
  const parsed=parseCustomerTextDetailed(text);
  assert.deepEqual(parsed.confirmations,[],text);
  const output=parsed.lines.map(row=>row.line).join('\n').toLowerCase();
  assert.equal(output.includes('1 = thùng'),false,text);
  assert.equal(output.includes('0 = cây'),false,text);
}

console.log('v21 ai product parser input-only cases: ok');
