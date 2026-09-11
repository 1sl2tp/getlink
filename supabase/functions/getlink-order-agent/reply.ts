export type ReplyKind=
  |"draft_update"
  |"clarification"
  |"price"
  |"price_list"
  |"checkout"
  |"round_suggestion"
  |"fallback";

export type ReplyDraft={
  replyKind:ReplyKind;
  body:string;
  followUp?:ReplyDraft|null;
};

function clean(value:unknown):string{return String(value??"").replace(/\s+/g," ").trim();}
export function formatVnd(value:unknown):string{
  const n=Math.max(0,Math.round(Number(value)||0));
  return new Intl.NumberFormat("vi-VN",{maximumFractionDigits:0}).format(n);
}
function qty(value:unknown):string{
  const n=Number(value)||0;
  return Number.isInteger(n)?String(n):String(Math.round(n*100)/100);
}
function lineTotal(line:any):number{
  return Math.round((Number(line?.quotedPriceVnd)||0)*(Number(line?.quantity)||0));
}
function linesTotal(lines:any[]):number{return (Array.isArray(lines)?lines:[]).reduce((sum,line)=>sum+lineTotal(line),0);}
function lineText(line:any):string{
  const name=clean(line?.productName)||"Sản phẩm";
  return `${name} × ${qty(line?.quantity)}`;
}

function marketSentence(market:any,unitLabel:string):string{
  if(!market||!Number(market.referencePriceVnd))return "";
  const reference=formatVnd(market.referencePriceVnd);
  const suffix=unitLabel?`/${unitLabel}`:"";
  if(market.position==="near")return ` Giá siêu thị tham khảo ${reference}${suffix}, hai bên đang gần tương đương chị nhé.`;
  const diff=formatVnd(Math.abs(Number(market.differenceVnd)||0));
  if(market.position==="store_higher")return ` Giá siêu thị tham khảo ${reference}${suffix}, hôm nay bên em cao hơn ${diff}, chị cân đối giúp em nhé ạ 😅`;
  if(market.position==="store_lower")return ` Giá siêu thị tham khảo ${reference}${suffix}, bên em đang thấp hơn ${diff} ạ 😄 Chị cân đối giá bán nhỉnh thêm chút vẫn ổn nhé.`;
  return "";
}

function clarificationQuestion(attribute:string):string{
  const key=clean(attribute).toLowerCase();
  if(key==="color")return "màu gì";
  if(key==="flavor")return "vị nào";
  if(key==="size")return "cỡ nào";
  if(key==="pack")return "quy cách nào";
  return "loại nào";
}

export function composeReply(result:any):ReplyDraft{
  const kind=clean(result?.kind);
  if(kind==="order_update"){
    const lines=Array.isArray(result?.lines)?result.lines:[];
    const bodyLines=lines.map(lineText);
    const total=linesTotal(lines);
    const body=[
      "Dạ em ghi rồi ạ 😄",
      ...bodyLines,
      `Tạm tính: ${formatVnd(total)}`,
    ].join("\n");
    let followUp:ReplyDraft|null=null;
    const round=result?.roundSuggestion;
    if(round&&Number(round.gap)>0&&Number(round.target)>0){
      followUp={
        replyKind:"round_suggestion",
        body:`Dạ đơn mình đang gần tròn ${qty(round.target)} thùng rồi ạ 😄 Chị lấy thêm giúp em ${qty(round.gap)} thùng nữa cho tròn ${qty(round.target)} nhé ạ.`,
      };
    }
    return {replyKind:"draft_update",body,followUp};
  }

  if(kind==="price"){
    const facts=result?.facts||{};
    const productName=clean(facts.productName)||"Sản phẩm này";
    const unitLabel=clean(facts.unitLabel||facts.primaryPackaging||facts.unitHint).toLowerCase();
    const suffix=unitLabel?`/${unitLabel}`:"";
    const own=formatVnd(facts.unitPriceVnd);
    const body=`Dạ ${productName} hôm nay bên em ${own}${suffix} ạ.${marketSentence(facts.marketComparison,unitLabel)}`;
    return {replyKind:"price",body};
  }

  if(kind==="clarification"){
    const facts=result?.facts||{};
    const name=clean(facts.productName)||"sản phẩm này";
    const missing=clean(facts.missingAttribute||facts.attribute||result?.missingAttribute)||"other";
    return {replyKind:"clarification",body:`Dạ ${name} chị lấy ${clarificationQuestion(missing)} ạ? 😄`};
  }

  if(kind==="price_list"){
    const list=result?.priceList||result?.facts||{};
    const scope=clean(list.scope||result?.scope)||"toàn bộ";
    const count=Number(list.count??list.items?.length)||0;
    const url=clean(list.url);
    const countText=count>0?` Có ${count} mặt hàng đang bán.`:"";
    const linkText=url?`\n${url}`:"";
    return {replyKind:"price_list",body:`Dạ em gửi chị bảng giá ${scope} hôm nay ạ 😄${countText}${linkText}`};
  }

  if(kind==="confirmation"){
    const lines=Array.isArray(result?.lines)?result.lines:[];
    const total=linesTotal(lines);
    const orderNo=clean(result?.orderNo||result?.salesOrderNo);
    const orderText=orderNo?` #${orderNo}`:"";
    const body=[
      `Dạ em chốt đơn tạm${orderText} cho chị rồi ạ 😄`,
      ...lines.map(lineText),
      `Tạm tính: ${formatVnd(total)}`,
      "Chị cần sửa hay thêm gì cứ nhắn em nhé ạ.",
    ].join("\n");
    return {replyKind:"checkout",body};
  }

  if(kind==="decline")return {replyKind:"fallback",body:"Dạ vâng chị ạ 😄 Em giữ đơn như hiện tại nhé."};

  return {
    replyKind:"fallback",
    body:"Dạ em chưa chắc ý này ạ 😅 Chị nhắn giúp em tên hàng + số lượng nhé, em ghi lại ngay ạ.",
  };
}
