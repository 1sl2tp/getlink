import assert from 'node:assert/strict';
import { resolveParsedLinesWithCatalog } from '../supabase/functions/v21-ai-product-parser/catalog-search.mjs';

const catalog=[
  {product_code:'TL-000030',product_name:'555 dẹt'},
  {product_code:'TL-000034',product_name:'555 dẹt bấm'},
  {product_code:'HT-000201',product_name:'Mì Hảo Hảo tôm chua cay 75g'},
  {product_code:'HT-000202',product_name:'Sữa tươi Vinamilk có đường 180ml'},
  {product_code:'HT-000203',product_name:'Sữa tươi TH true MILK có đường 180ml'},
];

function line(productName,quantity=1){
  return {quantity,productName,line:`${quantity} ${productName}`};
}

// Exact normalized lookup replaces customer wording with the stored product name.
assert.deepEqual(
  resolveParsedLinesWithCatalog([line('555 det',2)],catalog).map(row=>row.line),
  ['2 555 dẹt (555 det)'],
);

// A unique token-subset search is enough to sync to the stored product name.
assert.deepEqual(
  resolveParsedLinesWithCatalog([line('hao hao tom chua cay',2)],catalog).map(row=>row.line),
  ['2 Mì Hảo Hảo tôm chua cay 75g (hao hao tom chua cay)'],
);

// Ambiguous search must keep the parser result unchanged.
assert.deepEqual(
  resolveParsedLinesWithCatalog([line('sua tuoi',2)],catalog).map(row=>row.line),
  ['2 sua tuoi'],
);

// No match must also keep the parser result unchanged.
assert.deepEqual(
  resolveParsedLinesWithCatalog([line('san pham khong co',3)],catalog).map(row=>row.line),
  ['3 san pham khong co'],
);

// If the customer already typed the exact stored display name, do not add review parentheses.
assert.deepEqual(
  resolveParsedLinesWithCatalog([line('Mì Hảo Hảo tôm chua cay 75g',1)],catalog).map(row=>row.line),
  ['1 Mì Hảo Hảo tôm chua cay 75g'],
);

console.log('v21 ai catalog search sync cases: ok');
