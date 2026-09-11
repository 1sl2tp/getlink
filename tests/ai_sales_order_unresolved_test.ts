import assert from "node:assert/strict";
import { createSessionRepository } from "../supabase/functions/getlink-order-agent/repository.ts";

function memoryUnresolvedDb(){
  const rows:any[]=[];
  let seq=0;
  return {
    rows,
    from(table:string){
      assert.equal(table,"getlink_ai_unresolved_draft_lines");
      const filters:Array<[string,unknown]>=[];
      let mode:"read"|"upsert"|"update"="read";
      let payload:any=null;
      let onConflict="";
      const query:any={
        select(){return query;},
        eq(column:string,value:unknown){filters.push([column,value]);return query;},
        order(){return query;},
        upsert(value:any,opts:any){mode="upsert";payload=value;onConflict=String(opts?.onConflict||"");return query;},
        update(value:any){mode="update";payload=value;return query;},
        async single(){
          if(mode==="upsert"){
            assert.equal(onConflict,"session_id,line_key");
            const index=rows.findIndex(row=>row.session_id===payload.session_id&&row.line_key===payload.line_key);
            const next={id:index>=0?rows[index].id:`u${++seq}`,created_at:index>=0?rows[index].created_at:new Date().toISOString(),...index>=0?rows[index]:{},...payload};
            if(index>=0)rows[index]=next;else rows.push(next);
            return {data:next,error:null};
          }
          const selected=rows.find(row=>filters.every(([key,value])=>row[key]===value));
          if(mode==="update"&&selected)Object.assign(selected,payload);
          return {data:selected||null,error:null};
        },
        then(resolve:(value:any)=>unknown,reject:(reason:any)=>unknown){
          let selected=rows.filter(row=>filters.every(([key,value])=>row[key]===value));
          if(mode==="update")selected=selected.map(row=>Object.assign(row,payload));
          return Promise.resolve({data:selected,error:null}).then(resolve,reject);
        },
      };
      return query;
    },
  };
}

Deno.test("unresolved draft repository upserts by session and line key and lists pending rows",async()=>{
  const db:any=memoryUnresolvedDb();
  const repo:any=createSessionRepository(db);
  const line={
    lineKey:"message-1:0",
    sourceMessageId:"message-1",
    rawText:"2 bịch hướng dương",
    rawProductText:"hướng dương",
    quantity:2,
    unitHint:"bịch",
    contextFamily:null,
    candidateProductCodes:[],
    reason:"not_in_catalog",
    status:"pending",
    resolvedProductCode:null,
  };
  await repo.saveUnresolvedLine("session-1",line);
  await repo.saveUnresolvedLine("session-1",{...line,quantity:3});
  assert.equal(db.rows.length,1);
  assert.equal(db.rows[0].quantity,3);
  const pending=await repo.listUnresolvedLines("session-1","pending");
  assert.equal(pending.length,1);
  assert.equal(pending[0].lineKey,"message-1:0");
  assert.equal(pending[0].rawProductText,"hướng dương");
  assert.equal(pending[0].unitHint,"bịch");
  assert.equal(pending[0].reason,"not_in_catalog");
});

Deno.test("owner resolution marks one unresolved row resolved with catalog product code",async()=>{
  const db:any=memoryUnresolvedDb();
  const repo:any=createSessionRepository(db);
  const saved=await repo.saveUnresolvedLine("session-1",{
    lineKey:"message-1:1",sourceMessageId:"message-1",rawText:"2 bát 1.8kg",rawProductText:"bát 1.8kg",
    quantity:2,unitHint:null,contextFamily:"mi_chinh",candidateProductCodes:["HT-000099"],
    reason:"size_mismatch",status:"pending",resolvedProductCode:null,
  });
  const resolved=await repo.markUnresolvedResolved(saved.id,"HT-000099");
  assert.equal(resolved.status,"resolved");
  assert.equal(resolved.resolvedProductCode,"HT-000099");
  assert.equal((await repo.listUnresolvedLines("session-1","pending")).length,0);
});
