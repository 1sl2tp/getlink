export type TrainingCatalogItem={productCode:string;productName:string};
export type TrainingExample={rawText:string;productName:string;productCode:string|null;quantity:number|null;unitHint:string|null;status:string};
export type TrainingKnowledgeRule={ruleType:string;ruleText:string};
export type TrainingTranslation={kind:"order"|"teaching"|"knowledge"|"conversation";items:Array<{rawText:string;productName:string;quantity:number;unitHint:string|null;productCode:null;confidence:number}>;teachings:Array<{rawText:string;productName:string;productCode:null;quantity:number|null;unitHint:string|null}>;knowledge:TrainingKnowledgeRule[];replyText:string};
export type ModelCredentials={apiKey:string;model:string};

export class TrainingModelError extends Error{
  constructor(public code:string){super(code);this.name="TrainingModelError";}
}

const GEMINI_INTERACTIONS_URL="https://generativelanguage.googleapis.com/v1beta/interactions";
const C=(v:unknown,n=1000)=>String(v??"").replace(/\s+/g," ").trim().slice(0,n);

function outputText(payload:any):string{
  const direct=typeof payload?.output_text==="string"?payload.output_text.trim():"";
  if(direct)return direct;
  for(const step of Array.isArray(payload?.steps)?payload.steps:[]){
    if(step?.type!=="model_output")continue;
    for(const content of Array.isArray(step?.content)?step.content:[]){
      if(content?.type==="text"&&typeof content.text==="string"&&content.text.trim())return content.text.trim();
    }
  }
  throw new TrainingModelError("model_output_missing");
}

function schema(){return {
  type:"object",additionalProperties:false,
  properties:{
    kind:{type:"string",enum:["order","teaching","knowledge","conversation"]},
    items:{type:"array",items:{type:"object",additionalProperties:false,properties:{
      raw_text:{type:"string"},product_name:{type:"string"},quantity:{type:"number",minimum:0.000001},unit_hint:{type:["string","null"]},product_code:{type:["string","null"]},confidence:{type:"number",minimum:0,maximum:1},
    },required:["raw_text","product_name","quantity","unit_hint","product_code","confidence"]}},
    teachings:{type:"array",items:{type:"object",additionalProperties:false,properties:{
      raw_text:{type:"string"},product_name:{type:"string"},product_code:{type:["string","null"]},quantity:{type:["number","null"]},unit_hint:{type:["string","null"]},
    },required:["raw_text","product_name","product_code","quantity","unit_hint"]}},
    knowledge:{type:"array",items:{type:"object",additionalProperties:false,properties:{
      rule_type:{type:"string",enum:["behavior","naming","category","unit","product"]},rule_text:{type:"string"},
    },required:["rule_type","rule_text"]}},
    reply_text:{type:"string"},
  },required:["kind","items","teachings","knowledge","reply_text"],
};}

export async function translateTrainingMessageWithModel(
  input:{customerText:string;learnedExamples?:TrainingExample[];candidates?:TrainingCatalogItem[];knowledgeRules?:TrainingKnowledgeRule[]},
  fetchImpl:typeof fetch=fetch,
  credentials?:Partial<ModelCredentials>|null,
):Promise<TrainingTranslation>{
  const apiKey=C(credentials?.apiKey,500),model=C(credentials?.model,200);
  if(!apiKey||!model)throw new TrainingModelError("model_configuration_missing");
  const safe={
    customer_text:C(input.customerText,8000),
    learned_examples:(input.learnedExamples||[]).slice(0,80).map(r=>({
      raw_text:C(r.rawText,500),product_name:C(r.productName,300),product_code:r.productCode,
      quantity:r.quantity,unit_hint:r.unitHint,status:r.status,
    })),
    knowledge_rules:(input.knowledgeRules||[]).slice(0,120).map(r=>({rule_type:C(r.ruleType,40),rule_text:C(r.ruleText,600)})),
    candidate_catalog:(input.candidates||[]).slice(0,80).map(r=>({product_code:C(r.productCode,120),product_name:C(r.productName,300)})),
  };
  const systemInstruction=[
    "Bạn là bộ phân tích tin nhắn đặt hàng tiếng Việt cho cửa hàng tạp hóa.",
    "Nhiệm vụ là tách một hoặc nhiều dòng hàng từ tin nhắn lộn xộn thành tên sản phẩm khách đang nói, số lượng và đơn vị/quy cách nếu có.",
    "Bỏ qua câu trò chuyện không phải đặt hàng.",
    "knowledge_rules là kiến thức/quy tắc đã được người dùng dạy từ trước; phải ưu tiên áp dụng khi hiểu tin mới, nhưng không được biến chúng thành mã hàng nếu catalog không có.",
    "Nếu người dùng đang giải thích quy tắc dùng cho các tin sau, cách suy luận nhóm/hãng/quy cách/đơn vị, hoặc yêu cầu bot phải luôn xử lý theo một nguyên tắc thì kind=knowledge và tách thành các quy tắc nguyên tử ngắn gọn trong knowledge.",
    "Ví dụ loại knowledge: luôn trả tên sản phẩm + số lượng; bát là cách gọi mì chính; dầu ăn có các hãng Simply/Neptune/Meizan/Cái Lân; 1L/2L là dung tích và thường là chai.",
    "Không đánh dấu một đơn hàng thông thường là knowledge chỉ vì nó chứa tên nhóm hàng hoặc đơn vị.",
    "learned_examples có status corrected là bằng chứng mạnh nhất về cách khách gọi hàng.",
    "candidate_catalog chỉ là tên hàng thật của cửa hàng. Nếu một candidate phù hợp rõ ràng thì product_name phải dùng đúng tên canonical đó; tuyệt đối không tự tạo product_code.",
    "Nếu chưa đủ chắc chắn để map vào catalog, giữ product_name theo cách hiểu ngắn gọn của câu khách; backend sẽ đối chiếu tiếp.",
    "Nếu người dùng đang dạy hoặc sửa cách gọi theo dạng A = B thì kind=teaching và tách từng quan hệ thành teaching riêng.",
    "Teaching chung để quantity=null, unit_hint=null; teaching sửa dòng hàng cụ thể phải giữ quantity và unit_hint.",
    "Không tạo giá, mã hàng, tồn kho hay thông tin thương mại không có trong dữ liệu đầu vào.",
    "Chỉ dùng tin hiện tại và dữ liệu được cung cấp.",
  ].join(" ");
  const body={
    model,
    store:false,
    system_instruction:systemInstruction,
    input:JSON.stringify(safe),
    generation_config:{max_output_tokens:1400,thinking_level:"low"},
    response_format:{type:"text",mime_type:"application/json",schema:schema()},
  };

  let response:Response;
  try{
    response=await fetchImpl(GEMINI_INTERACTIONS_URL,{
      method:"POST",
      headers:{"x-goog-api-key":apiKey,"content-type":"application/json"},
      body:JSON.stringify(body),
    });
  }catch{throw new TrainingModelError("model_request_failed");}

  let payload:any;
  try{payload=await response.json();}
  catch{throw new TrainingModelError("model_response_not_json");}
  if(!response.ok||["failed","incomplete","cancelled","budget_exceeded"].includes(String(payload?.status||""))){
    throw new TrainingModelError("model_request_failed");
  }

  let parsed:any;
  try{parsed=JSON.parse(outputText(payload));}
  catch(error){if(error instanceof TrainingModelError)throw error;throw new TrainingModelError("model_output_invalid");}
  if(!parsed||!["order","teaching","knowledge","conversation"].includes(parsed.kind))throw new TrainingModelError("model_output_invalid");

  return {
    kind:parsed.kind,
    items:(parsed.items||[]).map((z:any)=>({
      rawText:C(z.raw_text),productName:C(z.product_name),quantity:Number(z.quantity),unitHint:z.unit_hint?C(z.unit_hint,80):null,productCode:null,confidence:Number(z.confidence)||0,
    })).filter((z:any)=>z.rawText&&z.productName&&Number.isFinite(z.quantity)&&z.quantity>0),
    teachings:(parsed.teachings||[]).map((z:any)=>({
      rawText:C(z.raw_text),productName:C(z.product_name),productCode:null,quantity:z.quantity==null?null:Number(z.quantity),unitHint:z.unit_hint?C(z.unit_hint,80):null,
    })).filter((z:any)=>z.rawText&&z.productName),
    knowledge:(parsed.knowledge||[]).map((z:any)=>({ruleType:C(z.rule_type,40),ruleText:C(z.rule_text,600)})).filter((z:any)=>z.ruleType&&z.ruleText),
    replyText:C(parsed.reply_text,2000),
  };
}
