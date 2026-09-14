(()=>{
  "use strict";
  const mq=window.matchMedia("(max-width:639px)");
  let ready=false;
  let timer=0;

  const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const attr=v=>esc(v).replace(/`/g,"&#96;");
  const compactMoney=value=>{
    const n=Number(value||0);
    if(!Number.isFinite(n)||n<=0)return"0";
    const compact=Math.round(n/500)*.5;
    return new Intl.NumberFormat("vi-VN",{maximumFractionDigits:1}).format(compact);
  };
  const selectedItems=()=>typeof window.userWorkSelectedItems==="function"?(window.userWorkSelectedItems()||[]):[];
  const activeMine=()=>{
    const root=document.getElementById("mobileUserWork");
    const active=document.querySelector('#mobileUserSourceTabs [data-mobile-scope="mine"].active,#mobileUserSourceTabs [data-mobile-scope="mine"][aria-pressed="true"]');
    return Boolean(root&&mq.matches&&active&&String(root.dataset.taphoaView||"sales")==="sales");
  };
  const rowFor=url=>{
    try{return typeof findLibraryRow==="function"?findLibraryRow(url):null}catch{return null}
  };
  const salePrice=row=>{
    try{if(typeof mobileUserSalePrice==="function")return Number(mobileUserSalePrice(row)||0)}catch{}
    return Number(row?.current_price||row?.regular_pack_price||row?.supplier_carton_price_vnd||row?.supplier_retail_price_vnd||0);
  };
  const costPrice=row=>Number(row?.supplier_input_price_vnd||row?.supplier_previous_input_price_vnd||0);
  const rowName=row=>{
    try{if(typeof canonicalDisplayName==="function")return canonicalDisplayName(row)}catch{}
    return String(row?.product_name||row?.name||row?.source_name||"Sản phẩm").trim()||"Sản phẩm";
  };

  function formatNow(){
    const d=new Date();
    const weekday=["CN","T2","T3","T4","T5","T6","T7"][d.getDay()];
    const dd=String(d.getDate()).padStart(2,"0"),mm=String(d.getMonth()+1).padStart(2,"0");
    const hh=String(d.getHours()).padStart(2,"0"),mi=String(d.getMinutes()).padStart(2,"0");
    return weekday+" "+dd+"/"+mm+" - "+hh+":"+mi;
  }

  function ensureHeader(){
    const root=document.getElementById("mobileUserWork");
    if(!root)return null;
    let head=document.getElementById("mobileStandardSalesHead");
    if(head)return head;
    head=document.createElement("div");
    head.id="mobileStandardSalesHead";
    head.className="mobile-standard-sales-head";
    head.innerHTML=
      '<button id="mobileStandardCustomerButton" class="mobile-standard-customer" type="button">Chọn khách</button>'+
      '<span id="mobileStandardTime" class="mobile-standard-time"></span>'+
      '<button id="mobileStandardCartButton" class="mobile-standard-cart-button" type="button" aria-haspopup="dialog" aria-controls="mobileStandardCartSheet">'+
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h2l2 10h9l2-7H7"/><circle cx="9" cy="19" r="1.4"/><circle cx="17" cy="19" r="1.4"/></svg>'+
        '<span class="count">0</span><span class="total">0</span>'+
      '</button>';
    const toolbar=root.querySelector(".mobile-user-toolbar");
    root.insertBefore(head,toolbar||root.firstChild);
    head.querySelector("#mobileStandardCustomerButton")?.addEventListener("click",()=>{
      const original=document.querySelector('[data-order-customer-for="mobileUserSendOrder"]');
      if(original&&!original.hidden)original.click();
    });
    head.querySelector("#mobileStandardCartButton")?.addEventListener("click",()=>openCart());
    return head;
  }

  function ensureCartSheet(){
    let layer=document.getElementById("mobileStandardCartLayer");
    if(layer)return layer;
    layer=document.createElement("div");
    layer.id="mobileStandardCartLayer";
    layer.className="mobile-standard-cart-layer";
    layer.hidden=true;
    layer.innerHTML=
      '<section id="mobileStandardCartSheet" class="mobile-standard-cart-sheet" role="dialog" aria-modal="true" aria-label="Giỏ hàng">'+
        '<header class="mobile-standard-cart-head"><strong>🛒 Giỏ hàng</strong><button class="mobile-standard-cart-close" type="button" aria-label="Đóng">×</button></header>'+
        '<div class="mobile-standard-cart-columns"><span>Tên</span><span>Đ.giá</span><span>SL</span><span>T.tiền</span></div>'+
        '<div id="mobileStandardCartRows" class="mobile-standard-cart-rows"></div>'+
        '<div class="mobile-standard-cart-summary"><span>Số lượng<b id="mobileStandardCartQty">0 sp</b></span><span>Tổng tiền<b id="mobileStandardCartTotal">0</b></span></div>'+
        '<div class="mobile-standard-cart-actions">'+
          '<button class="clear" type="button" data-mobile-standard-action="clear">🗑 Xóa</button>'+
          '<button class="order" type="button" data-mobile-standard-action="order">▣ Đặt</button>'+
          '<button class="sell" type="button" data-mobile-standard-action="sell">💰 Bán</button>'+
        '</div>'+
      '</section>';
    document.body.appendChild(layer);
    layer.addEventListener("click",event=>{
      if(event.target===layer||event.target.closest?.(".mobile-standard-cart-close")){closeCart();return}
      const qtyButton=event.target.closest?.("[data-mobile-cart-qty]");
      if(qtyButton){
        const url=String(qtyButton.dataset.url||"");
        const delta=Number(qtyButton.dataset.mobileCartQty)||0;
        changeQty(url,delta);
        return;
      }
      const action=event.target.closest?.("[data-mobile-standard-action]")?.dataset.mobileStandardAction;
      if(!action)return;
      if(action==="clear"){
        const original=document.querySelector('[data-order-cart-for="mobileUserSendOrder"] [data-order-cart-action="clear"]');
        if(original)original.click();else window.clearUserWorkOrderSelection?.();
        renderCart();
      }else if(action==="order"){
        document.getElementById("mobileUserSendOrder")?.click();
      }else if(action==="sell"){
        document.querySelector('[data-order-cart-for="mobileUserSendOrder"] [data-order-cart-action="quick"]')?.click();
      }
    });
    return layer;
  }

  function changeQty(url,delta){
    let current=0;
    const selected=selectedItems().find(item=>String(item?.row?.canonical_url||"")===url);
    if(selected)current=Number(selected.qty||0);
    const next=Math.max(0,Math.min(999,current+delta));
    try{
      if(typeof setUserWorkQty==="function")setUserWorkQty(url,next);
      else{
        const key="getlink:user-work-order-qty",map=JSON.parse(localStorage.getItem(key)||"{}");
        const k=String(url||"").toLowerCase();
        if(next)map[k]=next;else delete map[k];
        localStorage.setItem(key,JSON.stringify(map));
      }
    }catch{}
    window.renderUserWorkHome?.();
    window.updateUserWorkOrderSummary?.();
    sync();
  }

  function renderCart(){
    ensureCartSheet();
    const items=selectedItems();
    const rows=document.getElementById("mobileStandardCartRows");
    let qtyTotal=0,total=0;
    if(rows){
      rows.innerHTML=items.length?items.map(item=>{
        const row=item.row||{},qty=Math.max(0,Number(item.qty||0)),price=salePrice(row),line=qty*price;
        qtyTotal+=qty;total+=line;
        const pack=String(row?.supplier_primary_packaging||row?.supplier_retail_packaging||"").trim();
        return '<div class="mobile-standard-cart-row">'+
          '<span class="mobile-standard-cart-name"><strong>'+esc(rowName(row))+'</strong>'+(pack?'<small>'+esc(pack)+'</small>':'')+'</span>'+
          '<span class="mobile-standard-cart-price">'+compactMoney(price)+'</span>'+
          '<span class="mobile-standard-cart-qty"><button type="button" data-mobile-cart-qty="-1" data-url="'+attr(row.canonical_url)+'">−</button><b>'+qty+'</b><button type="button" data-mobile-cart-qty="1" data-url="'+attr(row.canonical_url)+'">+</button></span>'+
          '<span class="mobile-standard-cart-total">'+compactMoney(line)+'</span>'+
        '</div>';
      }).join(""):'<div class="mobile-standard-cart-empty">Chưa chọn sản phẩm.</div>';
    }
    document.getElementById("mobileStandardCartQty").textContent=qtyTotal+" sp";
    document.getElementById("mobileStandardCartTotal").textContent=compactMoney(total);
    const order=document.querySelector('[data-mobile-standard-action="order"]');
    const clear=document.querySelector('[data-mobile-standard-action="clear"]');
    const sell=document.querySelector('[data-mobile-standard-action="sell"]');
    if(order)order.disabled=!items.length;
    if(clear)clear.disabled=!items.length;
    const originalQuick=document.querySelector('[data-order-cart-for="mobileUserSendOrder"] [data-order-cart-action="quick"]');
    if(sell){sell.hidden=!originalQuick||originalQuick.hidden;sell.disabled=!items.length||!originalQuick||originalQuick.disabled;}
  }

  function openCart(){
    const layer=ensureCartSheet();
    renderCart();
    layer.hidden=false;
    document.body.classList.add("mobile-standard-cart-open");
  }
  function closeCart(){
    const layer=document.getElementById("mobileStandardCartLayer");
    if(layer)layer.hidden=true;
    document.body.classList.remove("mobile-standard-cart-open");
  }

  function decorateCards(){
    if(!activeMine())return;
    document.querySelectorAll('#mobileUserResults .mobile-user-mine-card[data-url]').forEach(card=>{
      const copy=card.querySelector(".mobile-user-product-copy");
      if(!copy||copy.querySelector(".mobile-standard-price-line"))return;
      const row=rowFor(card.dataset.url);
      if(!row)return;
      const cost=costPrice(row),sale=salePrice(row);
      const line=document.createElement("div");
      line.className="mobile-standard-price-line";
      line.innerHTML=(cost?'<span class="base">'+compactMoney(cost)+'</span><span class="arrow">→</span>':'')+'<b>'+compactMoney(sale)+'</b>';
      copy.appendChild(line);
    });
  }

  function syncCustomer(){
    const button=document.getElementById("mobileStandardCustomerButton");
    if(!button)return;
    const original=document.querySelector('[data-order-customer-for="mobileUserSendOrder"]');
    const snapshot=window.GETLINK_ACCESS_CONTEXT?.snapshot?.();
    if(original&&!original.hidden){button.disabled=false;button.textContent=String(original.textContent||"Chọn khách").replace(/^Khách\s*·\s*/,"")||"Chọn khách";return}
    button.disabled=true;
    button.textContent=String(snapshot?.account?.name||snapshot?.account?.username||"Khách lẻ");
  }

  function syncSummary(){
    const items=selectedItems();
    const qty=items.reduce((sum,item)=>sum+Number(item.qty||0),0);
    const total=items.reduce((sum,item)=>sum+Number(item.qty||0)*salePrice(item.row||{}),0);
    const cart=document.getElementById("mobileStandardCartButton");
    if(cart){
      const count=cart.querySelector(".count"),money=cart.querySelector(".total");
      if(count)count.textContent=String(items.length);
      if(money)money.textContent=compactMoney(total);
      cart.title=qty+" sản phẩm";
    }
    const time=document.getElementById("mobileStandardTime");
    if(time)time.textContent=formatNow();
  }

  function syncMode(){
    const root=document.getElementById("mobileUserWork");
    if(!root)return;
    root.classList.add("mobile-standard-ready");
    root.classList.toggle("mobile-standard-sales-active",activeMine());
    if(!activeMine())closeCart();
  }

  function sync(){
    if(!mq.matches)return;
    ensureHeader();
    ensureCartSheet();
    syncMode();
    syncCustomer();
    syncSummary();
    decorateCards();
    if(!document.getElementById("mobileStandardCartLayer")?.hidden)renderCart();
  }

  function init(){
    if(ready)return;
    const root=document.getElementById("mobileUserWork");
    if(!root||typeof window.userWorkSelectedItems!="function"||!window.GETLINK_ACCESS_CONTEXT)return;
    ready=true;
    ensureHeader();
    ensureCartSheet();
    document.addEventListener("getlink-cart-change",()=>queueMicrotask(sync));
    document.addEventListener("getlink-access-change",()=>queueMicrotask(sync));
    root.addEventListener("click",()=>queueMicrotask(sync));
    root.addEventListener("input",()=>queueMicrotask(sync));
    const observer=new MutationObserver(()=>queueMicrotask(sync));
    observer.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:["class","aria-pressed","hidden","data-taphoa-view"]});
    mq.addEventListener?.("change",()=>sync());
    window.addEventListener("resize",()=>sync());
    sync();
  }

  timer=window.setInterval(()=>{
    if(ready){clearInterval(timer);return}
    init();
  },60);
  window.setTimeout(init,0);
})();
