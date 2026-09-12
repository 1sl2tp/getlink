export type TrainingCatalogItem={productCode:string;productName:string};
export type TrainingExample={rawText:string;productName:string;productCode:string|null;quantity:number|null;unitHint:string|null;status:string};
export type TrainingTranslation={kind:"order"|"teaching"|"conversation";items:Array<{rawText:string;productName:string;quantity:number;unitHint:string|null;productCode:null;confidence:number}>;teachings:Array<{rawText:string;productName:string;productCode:null;quantity:number|null;unitHint:string|null}>;replyText:string};
export type ModelCredentials={apiKey:string;model:string};

export class TrainingModelError extends Error{
  constructor(public code:string){super(code);this.name="TrainingModelError";}
}

const C=(v:unknown,n=1000)=>String(v??"").replace(/\s+/g," ").trim().slice(0,n);

function outputText(payload:any):string{
  const direct=typeof payload?.output_text==="string"?payload.output_text.trim():"";
  if(direct)return direct;
  for(const item of Array.isArray(payload?.output)?payload.output:[]){
    for(const content of Array.isArray(item?.content)?item.content:[]){
      if(content?.type==="refusal")throw new TrainingModelError("model_refused");
      if(content?.type==="output_text"&&typeof content.text==="string"&&content.text.trim())return content.text.trim();
    }
  }
  throw new TrainingModelError("model_output_missing");
}

function schema(){return {
  type:"object",additionalProperties:false,
  properties:{
    kind:{type:"string",enum:["order","teaching","conversation"]},
    items:{type:"array",items:{type:"object",additionalProperties:false,properties:{
      raw_text:{type:"string"},product_name:{type:"string"},quantity:{type:"number"},unit_hint:{type:["string","null"]},product_code:{type:["string","null"]},confidence:{type:"number"},
    },required:["raw_text","product_name","quantity","unit_hint","product_code","confidence"]}},
    teachings:{type:"array",items:{type:"object",additionalProperties:false,properties:{
      raw_text:{type:"string"},product_name:{type:"string"},product_code:{type:["string","null"]},quantity:{type:["number","null"]},unit_hint:{type:["string","null"]},
    },required:["raw_text","product_name","product_code","quantity","unit_hint"]}},
    reply_text:{type:"string"},
  },required:["kind","items","teachings","reply_text"],
};}

export async function translateTrainingMessageWithModel(
  input:{customerText:string;learnedExamples?:TrainingExample[];candidates?:TrainingCatalogItem[]},
  fetchImpl:typeof fetch=fetch,
  credentials?:Partial<ModelCredentials>|null,
):Promise<TrainingTranslation>{
  const apiKey=C(credentials?.apiKey,500),model=C(credentials?.model,200);
  if(!apiKey||!model)throw new TrainingModelError("model_configuration_missing");
  const safe={
    customer_text:C(input.customerText,8000),
    learned_examples:(input.learnedExamples||[]).slice(0,40).map(r=>({
      raw_text:C(r.rawText,500),product_name:C(r.productName,300),product_code:r.productCode,
      quantity:r.quantity,unit_hint:r.unitHint,status:r.status,
    })),
    candidate_catalog:(input.candidates||[]).slice(0,20).map(r=>({product_code:C(r.productCode,120),product_name:C(r.productName,300)})),
  };
  const body={
    model,store:false,max_output_tokens:900,
    instructions:[
      "Đọc tin nhắn bán hàng và tách tên sản phẩm + số lượng.",
      "learned_examples corrected ưu tiên hơn auto.",
      "Nếu candidate_catalog có tên phù hợp thì product_name phải dùng đúng tên canonical đó; không tự tạo product_code.",
      "Nếu người dùng dạy hoặc sửa cách gọi thì kind=teaching.",
      "Một câu dạy có nhiều quan hệ hoặc tên tắt thì tách từng quan hệ thành teaching riêng.",
      "Teaching chung để quantity=null, unit_hint=null; teaching sửa dòng hàng cụ thể phải giữ quantity và unit_hint.",
      "Chỉ dùng tin hiện tại và dữ liệu được cung cấp.",
    ].join(" "),
    input:[{role:"user",content:[{type:"input_text",text:JSON.stringify(safe)}]}],
    text:{format:{type:"json_schema",name:"training",strict:true,schema:schema()}},
  };

  let response:Response;
  try{
    response=await fetchImpl("https://api.groq.com/openai/v1/responses",{
      method:"POST",headers:{authorization:`Bearer ${apiKey}`,"content-type":"application/json"},body:JSON.stringify(body),
    });
  }catch{throw new TrainingModelError("model_request_failed");}

  let payload:any;
  try{payload=await response.json();}
  catch{throw new TrainingModelError("model_response_not_json");}
  if(!response.ok||payload?.status==="failed"||payload?.status==="incomplete")throw new TrainingModelError("model_request_failed");

  let parsed:any;
  try{parsed=JSON.parse(outputText(payload));}
  catch(error){if(error instanceof TrainingModelError)throw error;throw new TrainingModelError("model_output_invalid");}
  if(!parsed||!["order","teaching","conversation"].includes(parsed.kind))throw new TrainingModelError("model_output_invalid");

  return {
    kind:parsed.kind,
    items:(parsed.items||[]).map((z:any)=>({
      rawText:C(z.raw_text),productName:C(z.product_name),quantity:Number(z.quantity),unitHint:z.unit_hint?C(z.unit_hint,80):null,productCode:null,confidence:Number(z.confidence)||0,
    })).filter((z:any)=>z.rawText&&z.productName&&Number.isFinite(z.quantity)&&z.quantity>0),
    teachings:(parsed.teachings||[]).map((z:any)=>({
      rawText:C(z.raw_text),productName:C(z.product_name),productCode:null,quantity:z.quantity==null?null:Number(z.quantity),unitHint:z.unit_hint?C(z.unit_hint,80):null,
    })).filter((z:any)=>z.rawText&&z.productName),
    replyText:C(parsed.reply_text,2000),
  };
}
