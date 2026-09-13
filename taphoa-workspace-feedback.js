(()=>{
  "use strict";

  const SALES_HEADERS=["Sản phẩm","Giá","Số lượng","Ghi chú"];
  const NOTE_KEY="getlink:work-order-line-notes-v1";
  const NOTE_MAX=160;
  const orderCache=new Map();
  let syncFrame=0;
  let exportsPatched=false;
  let fetchPatched=false;

  function escapeHtml(value){
    return String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  }
  function noteKey(url){return String(url||"").trim().toLowerCase()}
  function readNotes(){
    try{
      const value=JSON.parse(localStorage.getItem(NOTE_KEY)||"{}");
      return value&&typeof value==="object"?value:{};
    }catch{return {}}
  }
  function noteFor(url){return String(readNotes()[noteKey(url)]||"").slice(0,NOTE_MAX)}
  function setNote(url,value){
    const key=noteKey(url);if(!key)return "";
    const notes=readNotes(),next=String(value||"").replace(/\s+/g," ").trimStart().slice(0,NOTE_MAX);
    if(next)notes[key]=next;else delete notes[key];
    try{localStorage.setItem(NOTE_KEY,JSON.stringify(notes));}catch{}
    return next;
  }
  function clearNotes(urls=[]){
    const notes=readNotes();let changed=false;
    for(const url of urls){const key=noteKey(url);if(key&&Object.prototype.hasOwnProperty.call(notes,key)){delete notes[key];changed=true;}}
    if(changed){try{localStorage.setItem(NOTE_KEY,JSON.stringify(notes));}catch{}}
  }

  function isEmptyPrice(node){
    const text=String(node?.textContent||"").replace(/\s+/g," ").trim();
    return !text||text==="—"||text==="-";
  }
  function pickSingleSalePrice(row){
    const prices=row?.querySelectorAll?.(".user-work-order-price");
    if(!prices||prices.length<2)return;
    const primary=prices[0],secondary=prices[1];
    if(isEmptyPrice(primary)&&!isEmptyPrice(secondary))primary.innerHTML=secondary.innerHTML;
    if(secondary.getAttribute("aria-hidden")!=="true")secondary.setAttribute("aria-hidden","true");
  }
  function syncSalesHeader(){
    const head=document.querySelector("#userWorkMine .user-work-order-head");
    if(!head)return;
    const spans=[...head.children];
    if(spans.length<5)return;
    const labels=[SALES_HEADERS[0],SALES_HEADERS[1],"",SALES_HEADERS[2],SALES_HEADERS[3]];
    spans.forEach((span,index)=>{
      if(index<labels.length&&span.textContent!==labels[index])span.textContent=labels[index];
      if(index===2&&span.getAttribute("aria-hidden")!=="true")span.setAttribute("aria-hidden","true");
    });
    head.dataset.taphoaFeedback="1";
  }
  function syncSalesRows(){
    document.querySelectorAll("#userWorkMineRows .user-work-order-row").forEach(row=>{
      pickSingleSalePrice(row);
      const url=String(row.dataset.url||row.querySelector("[data-work-url]")?.dataset.workUrl||"");
      const input=row.querySelector(".user-work-order-bargain input");
      if(input&&!input.hasAttribute("data-work-note")){
        input.removeAttribute("data-work-bargain");
        input.removeAttribute("max");
        input.removeAttribute("inputmode");
        input.setAttribute("data-work-note",url);
        input.setAttribute("maxlength",String(NOTE_MAX));
        input.setAttribute("autocomplete","off");
        input.setAttribute("placeholder","Ghi chú");
        input.setAttribute("aria-label","Ghi chú sản phẩm");
        input.value=noteFor(url);
      }
      row.dataset.taphoaFeedback="1";
    });
  }

  function rememberOrders(payload){
    const rows=[];
    if(Array.isArray(payload?.orders))rows.push(...payload.orders);
    if(payload?.order)rows.push(payload.order);
    for(const order of rows){
      const id=String(order?.id||"");
      if(id)orderCache.set(id,order);
    }
    queueSync();
  }
  function syncOrderNotes(){
    document.querySelectorAll(".order-card[data-order-id]").forEach(card=>{
      const order=orderCache.get(String(card.dataset.orderId||""));
      if(!order||!Array.isArray(order.items))return;
      const lines=[...card.querySelectorAll(".order-card-items>div")];
      lines.forEach((line,index)=>{
        const note=String(order.items[index]?.note||"").trim();
        const current=line.querySelector(".order-item-note");
        if(!note){if(current)current.remove();return;}
        const text="Ghi chú: "+note;
        if(current){if(current.textContent!==text)current.textContent=text;return;}
        line.insertAdjacentHTML("beforeend",'<em class="order-item-note">'+escapeHtml(text)+"</em>");
      });
    });
  }

  function patchExports(){
    if(exportsPatched)return;
    const selected=window.userWorkSelectedItems;
    const load=window.loadUserWorkOrderSelection;
    const clear=window.clearUserWorkOrderSelection;
    if(typeof selected!=="function"||typeof load!=="function"||typeof clear!=="function")return;

    const originalSelected=selected;
    window.userWorkSelectedItems=function(){
      const rows=originalSelected.apply(this,arguments);
      return Array.isArray(rows)?rows.map(item=>({...item,bargain:0,lineNote:noteFor(item?.row?.canonical_url)})):rows;
    };

    const originalLoad=load;
    window.loadUserWorkOrderSelection=function(order){
      for(const item of Array.isArray(order?.items)?order.items:[]){
        if(item?.url)setNote(item.url,item.note||"");
      }
      const result=originalLoad.apply(this,arguments);
      queueSync();
      return result;
    };

    const originalClear=clear;
    window.clearUserWorkOrderSelection=function(){
      const active=typeof window.userWorkSelectedItems==="function"?window.userWorkSelectedItems():[];
      const urls=Array.isArray(active)?active.map(item=>item?.row?.canonical_url).filter(Boolean):[];
      const result=originalClear.apply(this,arguments);
      clearNotes(urls);
      queueSync();
      return result;
    };
    exportsPatched=true;
  }

  function shouldPatchOrderRequest(url,method){
    const text=String(url||"");
    return text.includes("/getlink-orders")&&(method==="POST"||method==="PUT");
  }
  function withLineNotes(body){
    if(!body||typeof body!=="object"||!Array.isArray(body.items))return body;
    return {...body,items:body.items.map(item=>({
      ...item,
      bargainPriceVnd:0,
      lineNote:noteFor(item?.url)
    }))};
  }
  function patchFetch(){
    if(fetchPatched||typeof window.fetch!=="function")return;
    const original=window.fetch.bind(window);
    window.fetch=async function(input,init={}){
      const url=typeof input==="string"?input:String(input?.url||"");
      const method=String(init?.method||input?.method||"GET").toUpperCase();
      let nextInit=init;
      if(shouldPatchOrderRequest(url,method)&&typeof init?.body==="string"){
        try{
          const parsed=JSON.parse(init.body);
          const next=withLineNotes(parsed);
          if(next!==parsed)nextInit={...init,body:JSON.stringify(next)};
        }catch{}
      }
      const response=await original(input,nextInit);
      if(url.includes("/getlink-orders")&&response?.ok){
        response.clone().json().then(rememberOrders).catch(()=>{});
      }
      return response;
    };
    fetchPatched=true;
  }

  function syncAll(){
    syncFrame=0;
    patchFetch();
    patchExports();
    syncSalesHeader();
    syncSalesRows();
    syncOrderNotes();
  }
  function queueSync(){
    if(syncFrame)return;
    syncFrame=requestAnimationFrame(syncAll);
  }

  document.addEventListener("input",event=>{
    const input=event.target?.closest?.("[data-work-note]");
    if(!input)return;
    const next=String(input.value||"").slice(0,NOTE_MAX);
    if(input.value!==next)input.value=next;
    setNote(input.dataset.workNote,next);
  },true);

  document.addEventListener("click",event=>{
    const qty=event.target?.closest?.("[data-work-qty]");
    if(!qty)return;
    window.setTimeout(()=>{
      const row=qty.closest(".user-work-order-row");
      const value=Number(row?.querySelector(".user-work-order-qty b")?.textContent||0);
      if(value<=0){
        const input=row?.querySelector("[data-work-note]");
        if(input){setNote(input.dataset.workNote,"");input.value="";}
      }
    },0);
  },true);

  const observer=new MutationObserver(queueSync);
  function boot(){
    patchFetch();
    observer.observe(document.documentElement,{subtree:true,childList:true});
    queueSync();
    let attempts=0;
    const timer=setInterval(()=>{
      syncAll();
      attempts+=1;
      if(exportsPatched||attempts>80)clearInterval(timer);
    },100);
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
})();
