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

// Comma is a product separator unless it is really a decimal comma.
assert.deepEqual(lines('1 cung,1 mem'),['1 Cung','1 Mem']);
assert.deepEqual(lines('1,5 sim'),['1.5 Sim']);
assert.deepEqual(lines('sim 1,5'),['1.5 Sim']);

// Numeric-leading brands are explicit exceptions: their leading number belongs to the name.
for(const [input,expected] of [
  ['555 det 2',['2 555 det']],
  ['3 mien 2',['2 3 mien']],
  ['3 miền 2',['2 3 miền']],
  ['7 up 2',['2 7 up']],
  ['2 555 det',['2 555 det']],
  ['2 3 mien',['2 3 mien']],
  ['2 7 up',['2 7 up']],
]) assert.deepEqual(lines(input),expected,input);

// A numeric brand without a quantity must not be mistaken for quantity + product.
assert.deepEqual(lines('555 det'),[]);
assert.deepEqual(lines('3 mien'),[]);
assert.deepEqual(lines('7 up'),[]);

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
