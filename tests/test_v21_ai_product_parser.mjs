import assert from 'node:assert/strict';
import { parseCustomerTextDetailed } from '../supabase/functions/v21-ai-product-parser/parser-core.mjs';

function lines(text){
  return parseCustomerTextDetailed(text).lines.map(row=>row.line);
}

assert.deepEqual(lines('sim 1 2'),['2 Sim 1']);
assert.deepEqual(lines('2 sim 1'),['2 Sim 1']);
assert.deepEqual(lines('cung 1'),['1 Cung']);
assert.deepEqual(lines('1 cung'),['1 Cung']);
assert.deepEqual(lines('1 cung, 1 mem, 1 det, 1 melon, 1 sg bam'),[
  '1 Cung','1 Mem','1 Det','1 Melon','1 Sg bam',
]);
assert.deepEqual(lines('cung 1 / det 1 / mem 1'),['1 Cung','1 Det','1 Mem']);
assert.deepEqual(lines('cung 1 det 1 mem 1'),[]);

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
