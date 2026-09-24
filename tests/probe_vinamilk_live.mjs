const endpoint="https://open-p04-vn.vinamilk.com.vn/api/graphql-pub/";
const body=JSON.stringify({operationName:"Probe",variables:{},query:"query Probe { __typename }"});
const r=await fetch(endpoint,{method:"POST",headers:{"content-type":"application/json"},body});
const t=await r.text();
console.log("VNM_GQL_STATUS",r.status);
console.log("VNM_GQL_BODY",t.slice(0,1600).replace(/\s+/g," "));
