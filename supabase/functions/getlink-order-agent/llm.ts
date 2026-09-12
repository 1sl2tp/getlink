import type { ParsedIntent } from "./types.ts";
import { validateParsedIntent } from "./types.ts";

export type ModelParseInput={
  customerText:string;
  recentContext?:Array<{role:"customer"|"assistant";text:string}>;
  candidates?:Array<{productCode:string;productName:string}>;
  awaitingClarification?:{attribute?:string;productName?:string}|null;
  listContext?:Array<{code:string;productCode:string;productName:string}>;
};

export type TrainingCatalogItem={productCode:string;productName:string};
export type TrainingExample={
  rawText:string;
  productName:string;
  productCode:string|null;
  quantity:number|null;
  unitHint:string|null;
  status:string;
};
export type TrainingModelInput={
  customerText:string;
  catalog?:TrainingCatalogItem[];
  learnedExamples?:TrainingExample[];
};
export type TrainingItem={
  rawText:string;
  productName:string;
  quantity:number;
  unitHint:string|null;
  productCode:string|null;
  confidence:number;
};
export type TrainingTeaching={
  rawText:string;
  productName:string;
  productCode:string|null;
  quantity?:number|null;
  unitHint?:string|null;
};
export type TrainingTranslation={
  kind:"order"|"teaching"|"conversation";
  items:TrainingItem[];
  teachings:TrainingTeaching[];
  replyText:string;
};

export type ModelCredentials={apiKey:string;model:string;};

export class ModelParseError extends Error{
  code="model_unavailable_or_invalid";
  constructor(message="model_unavailable_or_invalid"){
    super(message);
    this.name="ModelParseError";
  }
}

const intentSchema={
  type:"object",
  additionalProperties:false,
  properties:{
    intent:{type:"string",enum:["ignore","add_item","change_qty","remove_item","price_query","price_list","confirm","decline","clarification_answer"]},
    raw_product_text:{type:"string"},
    quantity:{type:["number","null"],exclusiveMinimum:0},
    unit_hint:{type:["string","null"]},
    attributes:{
      type:"object",additionalProperties:false,
      properties:{color:{type:["string","null"]},flavor:{type:["string","null"]},size:{type:["string","null"]},pack:{type:["string","null"]},other:{type:["string","null"]}},
      required:["color","flavor","size","pack","other"],
    },
    line_note:{type:"string"},
    reference_target:{type:["string","null"]},
    needs_clarification:{type:"boolean"},
    clarification_question_hint:{type:["string","null"]},
  },
  required:["intent","raw_product_text","quantity","unit_hint","attributes","line_note","reference_target","needs_clarification","clarification_question_hint"],
} as const;

const trainingSchema={
  type:"object",
  additionalProperties:false,
  properties:{
    kind:{type:"string",enum:["order","teaching","conversation"]},
    items:{
      type:"array",maxItems:40,
      items:{
        type:"object",additionalProperties:false,
        properties:{
          raw_text:{type:"string"},product_name:{type:"string"},quantity:{type:"number",exclusiveMinimum:0},
          unit_hint:{type:["string","null"]},product_code:{type:["string","null"]},confidence:{type:"number",minimum:0,maximum:1},
        },
        required:["raw_text","product_name","quantity","unit_hint","product_code","confidence"],
      },
    },
    teachings:{
      type:"array",maxItems:20,
      items:{
        type:"object",additionalProperties:false,
        properties:{
          raw_text:{type:"string"},product_name:{type:"string"},product_code:{type:["string","null"]},
          quantity:{type:["number","null"],exclusiveMinimum:0},unit_hint:{type:["string","null"]},
        },
        required:["raw_text","product_name","product_code","quantity","unit_hint"],
      },
    },
    reply_text:{type:"string"},
  },
  required:["kind","items","teachings","reply_text"],
} as const;

function boundedText(value:unknown,max=1000):string{return String(value??"").replace(/\s+/g," ").trim().slice(0,max);}

function sanitizedInput(input:ModelParseInput){
  return {
    customer_text:boundedText(input.customerText,2000),
    recent_context:(input.recentContext||[]).slice(-8).map(row=>({role:row.role,text:boundedText(row.text,500)})),
    candidates:(input.candidates||[]).slice(0,20).map(row=>({product_code:boundedText(row.productCode,120),product_name:boundedText(row.productName,300)})),
    awaiting_clarification:input.awaitingClarification?{attribute:boundedText(input.awaitingClarification.attribute,80),product_name:boundedText(input.awaitingClarification.productName,300)}:null,
    list_context:(input.listContext||[]).slice(0,30).map(row=>({code:boundedText(row.code,80),product_code:boundedText(row.productCode,120),product_name:boundedText(row.productName,300)})),
  };
}

function sanitizedTrainingInput(input:TrainingModelInput){
  return {
    customer_text:boundedText(input.customerText,8000),
    learned_examples:(input.learnedExamples||[]).slice(0,40).map(row=>({
      raw_text:boundedText(row.rawText,500),product_name:boundedText(row.productName,300),
      product_code:row.productCode?boundedText(row.productCode,120):null,
      quantity:row.quantity==null?null:Number(row.quantity),unit_hint:row.unitHint?boundedText(row.unitHint,80):null,status:boundedText(row.status,40),
    })),
  };
}

function extractOutputText(payload:any):string{
  const direct=typeof payload?.output_text==="string"?payload.output_text.trim():"";
  if(direct)return direct;
  for(const item of Array.isArray(payload?.output)?payload.output:[]){
    for(const content of Array.isArray(item?.content)?item.content:[]){
      if(content?.type==="refusal")throw new ModelParseError("model_refused");
      if(content?.type==="output_text"&&typeof content.text==="string"&&content.text.trim())return content.text.trim();
    }
  }
  throw new ModelParseError("model_output_missing");
}

function modelCredentials(credentials?:Partial<ModelCredentials>|null):ModelCredentials{
  const apiKey=String(credentials?.apiKey??Deno.env.get("GROQ_API_KEY")??Deno.env.get("OPENAI_API_KEY")??"").trim();
  const model=String(credentials?.model??Deno.env.get("ORDER_AGENT_MODEL")??"").trim();
  if(!apiKey||!model)throw new ModelParseError("model_configuration_missing");
  return {apiKey,model};
}

async function callGroq(body:any,fetchImpl:typeof fetch,apiKey:string):Promise<any>{
  let response:Response;
  try{
    response=await fetchImpl("https://api.groq.com/openai/v1/responses",{
      method:"POST",headers:{authorization:`Bearer ${apiKey}`,"content-type":"application/json"},body:JSON.stringify(body),
    });
  }catch{throw new ModelParseError("model_request_failed:network");}
  let payload:any;
  try{payload=await response.json();}
  catch{throw new ModelParseError(`model_response_not_json:${response.status}`);}
  if(!response.ok||payload?.status==="failed"||payload?.status==="incomplete"){
    throw new ModelParseError(`model_request_failed:${response.status}`);
  }
  return payload;
}

function validateTrainingTranslation(input:any,catalog:TrainingCatalogItem[]):TrainingTranslation{
  if(!input||typeof input!=="object")throw new ModelParseError("model_output_invalid");
  const kind=String(input.kind||"") as TrainingTranslation["kind"];
  if(!["order","teaching","conversation"].includes(kind))throw new ModelParseError("model_output_invalid");
  const catalogByCode=new Map(catalog.map(row=>[String(row.productCode),row]));
  const items=(Array.isArray(input.items)?input.items:[]).map((row:any)=>{
    const rawText=boundedText(row?.raw_text,1000);let productName=boundedText(row?.product_name,400);
    const quantity=Number(row?.quantity);const confidence=Math.max(0,Math.min(1,Number(row?.confidence)||0));
    if(!rawText||!productName||!Number.isFinite(quantity)||quantity<=0)throw new ModelParseError("model_output_invalid");
    let productCode=row?.product_code==null?null:boundedText(row.product_code,120)||null;
    if(productCode&&!catalogByCode.has(productCode))productCode=null;
    if(productCode)productName=String(catalogByCode.get(productCode)?.productName||productName);
    return {rawText,productName,quantity,unitHint:row?.unit_hint==null?null:boundedText(row.unit_hint,80)||null,productCode,confidence} as TrainingItem;
  });
  const teachings=(Array.isArray(input.teachings)?input.teachings:[]).map((row:any)=>{
    const rawText=boundedText(row?.raw_text,1000);let productName=boundedText(row?.product_name,400);
    if(!rawText||!productName)throw new ModelParseError("model_output_invalid");
    let productCode=row?.product_code==null?null:boundedText(row.product_code,120)||null;
    if(productCode&&!catalogByCode.has(productCode))productCode=null;
    if(productCode)productName=String(catalogByCode.get(productCode)?.productName||productName);
    let quantity:number|null=null;
    if(row?.quantity!==null&&row?.quantity!==undefined&&row?.quantity!==""){
      quantity=Number(row.quantity);
      if(!Number.isFinite(quantity)||quantity<=0)throw new ModelParseError("model_output_invalid");
    }
    const unitHint=row?.unit_hint==null?null:boundedText(row.unit_hint,80)||null;
    return {rawText,productName,productCode,quantity,unitHint} as TrainingTeaching;
  });
  return {kind,items,teachings,replyText:boundedText(input.reply_text,2000)};
}

export async function parseWithModel(input:ModelParseInput,fetchImpl:typeof fetch=fetch,credentials?:Partial<ModelCredentials>|null):Promise<ParsedIntent>{
  const {apiKey,model}=modelCredentials(credentials);const safe=sanitizedInput(input);
  if(!safe.customer_text)throw new ModelParseError("customer_text_required");
  const body={
    model,store:false,max_output_tokens:350,
    instructions:[
      "Bạn là bộ phân tích ý định đặt hàng tiếng Việt cho cửa hàng tạp hóa.",
      "Chỉ phân tích lời khách thành JSON đúng schema; không tự tạo giá, tổng tiền, tồn kho hoặc product id.",
      "reference_target chỉ được dùng khi nó xuất hiện trong candidates/list_context; nếu không chắc hãy để null và needs_clarification=true.",
      "Hiểu viết tắt, thiếu dấu và câu sửa theo recent_context. Nếu đang chờ màu/vị/size, ưu tiên hiểu câu hiện tại là clarification_answer.",
      "Không trò chuyện với khách ở bước này; chỉ trả structured JSON.",
    ].join(" "),
    input:[{role:"user",content:[{type:"input_text",text:`Dữ liệu JSON tối thiểu để phân tích:\n${JSON.stringify(safe)}`}]}],
    text:{format:{type:"json_schema",name:"getlink_order_intent",strict:true,schema:intentSchema}},
  };
  const payload=await callGroq(body,fetchImpl,apiKey);
  try{return validateParsedIntent(JSON.parse(extractOutputText(payload)));}
  catch(error){if(error instanceof ModelParseError)throw error;throw new ModelParseError("model_output_invalid");}
}

export async function translateTrainingMessageWithModel(input:TrainingModelInput,fetchImpl:typeof fetch=fetch,credentials?:Partial<ModelCredentials>|null):Promise<TrainingTranslation>{
  const {apiKey,model}=modelCredentials(credentials);const safe=sanitizedTrainingInput(input);
  if(!safe.customer_text)throw new ModelParseError("customer_text_required");
  const body={
    model,store:false,max_output_tokens:500,
    instructions:[
      "Bạn chỉ làm một việc: đọc tin nhắn bán hàng tiếng Việt và tách thành TÊN SẢN PHẨM + SỐ LƯỢNG.",
      "Tên có thể đứng trước số lượng hoặc số lượng đứng trước tên. Tự hiểu bằng ngôn ngữ, không dựa vào parser phía server.",
      "learned_examples là các ví dụ người dùng đã dạy; ưu tiên corrected hơn auto khi có xung đột và khái quát cách hiểu sang câu mới.",
      "Không có catalog trong bước này. Không tự chọn product_code; luôn để product_code=null. Chỉ trả tên sản phẩm mà bạn hiểu từ câu và số lượng.",
      "Nếu người dùng đang dạy/sửa cách hiểu, kind=teaching. Nếu là hội thoại không phải mặt hàng, kind=conversation. Nếu là đơn, kind=order.",
      "Khi một câu dạy chứa nhiều quan hệ hoặc nhiều tên tắt, tách mỗi quan hệ thành một teaching riêng; không gom cả câu dạy thành một sản phẩm.",
      "Teaching kiến thức chung như tên tắt hoặc thương hiệu để quantity=null và unit_hint=null. Teaching sửa một dòng hàng cụ thể phải giữ quantity và unit_hint nếu người dùng đã nêu.",
      "Mỗi mặt hàng là một item riêng và chỉ lấy từ tin hiện tại; không kéo mặt hàng của tin trước vào.",
      "Chỉ trả JSON đúng schema, không thêm giải thích ngoài JSON.",
    ].join(" "),
    input:[{role:"user",content:[{type:"input_text",text:`Tin hiện tại và ví dụ đã học:\n${JSON.stringify(safe)}`}]}],
    text:{format:{type:"json_schema",name:"getlink_training_translation",strict:true,schema:trainingSchema}},
  };
  const payload=await callGroq(body,fetchImpl,apiKey);
  try{return validateTrainingTranslation(JSON.parse(extractOutputText(payload)),input.catalog||[]);}
  catch(error){if(error instanceof ModelParseError)throw error;throw new ModelParseError("model_output_invalid");}
}
