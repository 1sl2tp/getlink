const endpoint="https://open-p04-vn.vinamilk.com.vn/api/graphql-pub/";
async function post(headers={}){
  const body=JSON.stringify({operationName:"Probe",variables:{},query:"query Probe { __typename }"});
  const r=await fetch(endpoint,{method:"POST",headers:{"content-type":"application/json",...headers},body});
  const t=await r.text();
  console.log("GQL_STATUS",r.status);
  console.log("GQL_HEADERS",JSON.stringify(Object.fromEntries(r.headers)));
  console.log("GQL_BODY",t.slice(0,1200).replace(/\s+/g," "));
}
await post();
