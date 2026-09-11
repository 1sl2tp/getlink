import assert from "node:assert/strict";

import { segmentOrderMessage } from "../supabase/functions/getlink-order-agent/multiline.ts";
import {
  emptyOrderContext,
  parseDeterministicOrderFragment,
} from "../supabase/functions/getlink-order-agent/deterministic.ts";

const TEST_MESSAGE=`2 bịch hướng dương
- 2 bát 1.8kg, 2 bát 1kg, 2 bát 454
- 2 omo 1.15kg, 2 omo 5.5kg, 2 omo 5.1kg, 2 omo 2.9kg, 2 omo 2.6kg, 2 omo 700g, 1 omo 380g
- 2 cái lân 1l, 2 cái lân 5l
- 2 meizan 1l, 2 meizan 5l
- 5 gạo 2l, 5 nep 2l`;

Deno.test("multiline segmenter preserves all 17 ordered item fragments",()=>{
  const fragments=segmentOrderMessage(TEST_MESSAGE);
  assert.equal(fragments.length,17);
  assert.deepEqual(fragments.map((row:any)=>row.rawText),[
    "2 bịch hướng dương",
    "2 bát 1.8kg","2 bát 1kg","2 bát 454",
    "2 omo 1.15kg","2 omo 5.5kg","2 omo 5.1kg","2 omo 2.9kg","2 omo 2.6kg","2 omo 700g","1 omo 380g",
    "2 cái lân 1l","2 cái lân 5l",
    "2 meizan 1l","2 meizan 5l",
    "5 gạo 2l","5 nep 2l",
  ]);
  assert.deepEqual(
    {quantity:fragments[0].quantity,rawProductText:fragments[0].rawProductText,unitHint:fragments[0].unitHint},
    {quantity:2,rawProductText:"hướng dương",unitHint:"bịch"},
  );
  assert.equal(fragments[16].index,16);
});

Deno.test("segmenter does not split ordinary comma prose without a new quantity",()=>{
  const fragments=segmentOrderMessage("chị lấy omo loại mới, nếu còn hàng thì để riêng");
  assert.equal(fragments.length,1);
  assert.equal(fragments[0].rawText,"chị lấy omo loại mới, nếu còn hàng thì để riêng");
});

Deno.test("deterministic fragment parser keeps unsafe Bat 1.8 unresolved but maps safe Bat sizes",()=>{
  const fragments=segmentOrderMessage("2 bát 1.8kg, 2 bát 1kg, 2 bát 454");
  let context=emptyOrderContext();
  const parsed=fragments.map((fragment:any)=>{
    const result=parseDeterministicOrderFragment(fragment,context);
    context=result.context;
    return result;
  });

  assert.equal(parsed[0].kind,"unresolved");
  assert.equal(parsed[0].rawProductText,"bát 1.8kg");
  assert.equal(parsed[0].reason,"size_mismatch");
  assert.equal(parsed[0].context.family,"mi_chinh");
  assert.equal(parsed[1].kind,"resolved");
  assert.equal(parsed[1].lookupText,"Mi chinh bat 1");
  assert.equal(parsed[2].lookupText,"Mi chinh bat 454");
});

Deno.test("deterministic fragment parser maps all exact Omo sizes to hoa my pham",()=>{
  const fragments=segmentOrderMessage("2 omo 1.15kg, 2 omo 5.5kg, 2 omo 5.1kg, 2 omo 2.9kg, 2 omo 2.6kg, 2 omo 700g, 1 omo 380g");
  let context=emptyOrderContext();
  const parsed=fragments.map((fragment:any)=>{
    const result=parseDeterministicOrderFragment(fragment,context);
    context=result.context;
    return result;
  });
  assert.deepEqual(parsed.map((row:any)=>row.lookupText),[
    "Bot giat omo 1.15kg","Bot giat omo 5.5kg","Bot giat omo 5.1kg","Bot giat omo 2.9kg",
    "Bot giat omo 2.6kg","Bot giat omo 700g","Bot giat omo 380g",
  ]);
  assert.ok(parsed.every((row:any)=>row.kind==="resolved"&&row.context.family==="hoa_my_pham"));
});

Deno.test("oil sequence resolves Cai Lan Meizan rice-bran and Nep using current family",()=>{
  const fragments=segmentOrderMessage("2 cái lân 1l, 2 cái lân 5l\n2 meizan 1l, 2 meizan 5l\n5 gạo 2l, 5 nep 2l");
  let context=emptyOrderContext();
  const parsed=fragments.map((fragment:any)=>{
    const result=parseDeterministicOrderFragment(fragment,context);
    context=result.context;
    return result;
  });
  assert.deepEqual(parsed.map((row:any)=>row.lookupText),[
    "Dau lan 1","Dau lan 5","Dau zan 1","Dau zan 5","Dau sim gao 2","Dau nep 2",
  ]);
  assert.ok(parsed.every((row:any)=>row.kind==="resolved"&&row.context.family==="dau_an"));
});

Deno.test("missing sunflower catalog item remains unresolved with quantity and bag unit",()=>{
  const [fragment]=segmentOrderMessage("2 bịch hướng dương");
  const parsed=parseDeterministicOrderFragment(fragment,emptyOrderContext());
  assert.equal(parsed.kind,"unresolved");
  assert.equal(parsed.rawProductText,"hướng dương");
  assert.equal(parsed.quantity,2);
  assert.equal(parsed.unitHint,"bịch");
  assert.equal(parsed.reason,"not_in_catalog");
});
