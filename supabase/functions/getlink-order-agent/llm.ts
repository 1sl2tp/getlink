import type { ParsedIntent } from "./types.ts";
import { validateParsedIntent } from "./types.ts";

export type ModelParseInput={
  customerText:string;
  recentContext?:Array<{role:"customer"|"assistant";text:string}>;
  candidates?:Array<{productCode:string;productName:string}>;
  awaitingClarification?:{attribute?:string;productName?:string}|null;
  listContext?:Array<{code:string;productCode:string;productName:string}>;
};

export type ModelCredentials={
  apiKey:string;
  model:string;
};

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
    intent:{
      type:"string",
      enum:["ignore","add_item","change_qty","remove_item","price_query","price_list","confirm","decline","clarification_answer"],
    },
    raw_product_text:{type:"string"},
    quantity:{type:["number","null"],exclusiveMinimum:0},
    unit_hint:{type:["string","null"]},
    attributes:{
      type:"object",
      additionalProperties:false,
      properties:{
        color:{type:["string","null"]},
        flavor:{type:["string","null"]},
        size:{type:["string","null"]},
        pack:{type:["string","null"]},
        other:{type:["string","null"]},
      },
      required:["color","flavor","size","pack","other"],
    },
    line_note:{type:"string"},
    reference_target:{type:["string","null"]},
    needs_clarification:{type:"boolean"},
    clarification_question_hint:{type:["string","null"]},
  },
  required:[
    "intent","raw_product_text","quantity","unit_hint","attributes","line_note",
    "reference_target","needs_clarification","clarification_question_hint",
  ],
} as const;

function boundedText(value:unknown,max=1000):string{
  return String(value??"").replace(/\s+/g," ").trim().slice(0,max);
}

function sanitizedInput(input:ModelParseInput){
  return {
    customer_text:boundedText(input.customerText,2000),
    recent_context:(input.recentContext||[]).slice(-8).map(row=>({
      role:row.role,
      text:boundedText(row.text,500),
    })),
    candidates:(input.candidates||[]).slice(0,20).map(row=>({
      product_code:boundedText(row.productCode,120),
      product_name:boundedText(row.productName,300),
    })),
    awaiting_clarification:input.awaitingClarification?{
      attribute:boundedText(input.awaitingClarification.attribute,80),
      product_name:boundedText(input.awaitingClarification.productName,300),
    }:null,
    list_context:(input.listContext||[]).slice(0,30).map(row=>({
      code:boundedText(row.code,80),
      product_code:boundedText(row.productCode,120),
      product_name:boundedText(row.productName,300),
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

export async function parseWithModel(
  input:ModelParseInput,
  fetchImpl:typeof fetch=fetch,
  credentials?:Partial<ModelCredentials>|null,
):Promise<ParsedIntent>{
  const apiKey=String(credentials?.apiKey??Deno.env.get("OPENAI_API_KEY")??"").trim();
  const model=String(credentials?.model??Deno.env.get("ORDER_AGENT_MODEL")??"").trim();
  if(!apiKey||!model)throw new ModelParseError("model_configuration_missing");
  const safe=sanitizedInput(input);
  if(!safe.customer_text)throw new ModelParseError("customer_text_required");

  const body={
    model,
    store:false,
    instructions:[
      "Bạn là bộ phân tích ý định đặt hàng tiếng Việt cho cửa hàng tạp hóa.",
      "Chỉ phân tích lời khách thành JSON đúng schema; không tự tạo giá, tổng tiền, tồn kho hoặc product id.",
      "reference_target chỉ được dùng khi nó xuất hiện trong candidates/list_context; nếu không chắc hãy để null và needs_clarification=true.",
      "Hiểu viết tắt, thiếu dấu và câu sửa theo recent_context. Nếu đang chờ màu/vị/size, ưu tiên hiểu câu hiện tại là clarification_answer.",
      "Không trò chuyện với khách ở bước này; chỉ trả structured JSON.",
    ].join(" "),
    input:[{
      role:"user",
      content:[{
        type:"input_text",
        text:`Dữ liệu JSON tối thiểu để phân tích:\n${JSON.stringify(safe)}`,
      }],
    }],
    text:{
      format:{
        type:"json_schema",
        name:"getlink_order_intent",
        strict:true,
        schema:intentSchema,
      },
    },
  };

  let response:Response;
  try{
    response=await fetchImpl("https://api.openai.com/v1/responses",{
      method:"POST",
      headers:{
        "authorization":`Bearer ${apiKey}`,
        "content-type":"application/json",
      },
      body:JSON.stringify(body),
    });
  }catch{
    throw new ModelParseError("model_request_failed");
  }

  let payload:any;
  try{payload=await response.json();}
  catch{throw new ModelParseError("model_response_not_json");}
  if(!response.ok||payload?.status==="failed"||payload?.status==="incomplete"){
    throw new ModelParseError("model_request_failed");
  }

  try{
    const parsed=JSON.parse(extractOutputText(payload));
    return validateParsedIntent(parsed);
  }catch(error){
    if(error instanceof ModelParseError)throw error;
    throw new ModelParseError("model_output_invalid");
  }
}
