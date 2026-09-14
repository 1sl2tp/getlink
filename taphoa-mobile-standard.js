(()=>{
  "use strict";

  const MOBILE_QUERY="(max-width:639px)";
  const AUTH_KEY="getlink:chat-order-auth";
  let clockTimer=0;

  const mobile=()=>window.matchMedia(MOBILE_QUERY).matches;
  const byId=id=>document.getElementById(id);
  const esc=value=>String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  const attr=esc;

  function compactMoney(value){
    const n=Number(value||0);
    if(!Number.isFinite(n))return"—";
    const compact=Math.round(n/500)*.5;
    return new Intl.NumberFormat("vi-VN",{minimumFractionDigits:0,maximumFractionDigits:1}).format(compact);
  }

  function readAuth(){
    try{return JSON.parse(sessionStorage.getItem(AUTH_KEY)||"null")}catch{return null}
  }

  function selectedItems(){
    const rows=typeof window.userWorkSelectedItems==="function"?window.userWorkSelectedItems():[];
    return Array.isArray(rows)?rows:[];
  }

  function itemPrice(item){
    const row=item?.row||{};
    if(typeof window.mobileUserSalePrice==="function"){
      const value=Number(window.mobileUserSalePrice(row)||0);
      if(Number.isFinite(value))return value;
    }
    return Number(row.current_price||row.regular_pack_price||row.selling_price_vnd||row.display_price_vnd||0)||0;
  }

  function itemName(item){
    const row=item?.row||{};
    if(typeof window.canonicalDisplayName==="function"){
      try{return String(window.canonicalDisplayName(row)||"Sản phẩm")}catch{}
    }
    return String(row.product_name||row.name||row.source_name||"Sản phẩm");
  }

  function totals(){
    const items=selectedItems();
    let products=0,total=0;
    for(const item of items){
      const qty=Math.max(0,Number(item?.qty||0));
      products+=qty;
      total+=qty*itemPrice(item);
    }
    return{items,lines:items.length,products,total};
  }

  function taphoaScopeActive(){
    const active=document.querySelector('#mobileUserSourceTabs [data-mobile-scope="mine"].active,#mobileUserSourceTabs [data-mobile-scope="mine"][aria-pressed="true"]');
    return Boolean(active);
  }

  function salesViewActive(){
    const root=byId("mobileUserWork");
    return taphoaScopeActive()&&String(root?.dataset?.taphoaView||"sales")==="sales";
  }

  function updateClock(){
    const node=byId("mobileSalesClock");
    if(!node)return;
    const now=new Date();
    const date=new Intl.DateTimeFormat("vi-VN",{day:"2-digit",month:"2-digit"}).format(now);
    const time=new Intl.DateTimeFormat("vi-VN",{hour:"2-digit",minute:"2-digit",hour12:false}).format(now);
    node.textContent=date+" · "+time;
  }

  function ensureMobileSalesHead(){
    const mobileUserWork=byId("mobileUserWork");
    const toolbar=mobileUserWork?.querySelector(".mobile-user-toolbar");
    if(!mobileUserWork||!toolbar)return null;
    let head=byId("mobileSalesHead");
    if(!head){
      head=document.createElement("section");
      head.id="mobileSalesHead";
      head.className="mobile-sales-head";
      head.innerHTML=
        '<button type="button" class="mobile-sales-customer" data-order-customer-select="true" aria-label="Chọn khách hàng">Chọn khách</button>'+ 
        '<span id="mobileSalesClock" class="mobile-sales-clock"></span>'+ 
        '<button id="mobileSalesCartButton" class="mobile-sales-cart-button" type="button" aria-haspopup="dialog" aria-controls="mobileSalesCartSheet">'+
          '<span class="mobile-sales-cart-icon" aria-hidden="true">🛒</span>'+ 
          '<span><b id="mobileSalesCartCount">0 dòng</b><small id="mobileSalesCartTotal">0</small></span>'+ 
        '</button>';
      mobileUserWork.insertBefore(head,toolbar);
    }
    updateClock();
    return head;
  }

  function standardizeMobileWorkNav(){
    if(!mobile())return;
    const nav=document.querySelector(".taphoa-work-nav.mobile");
    const root=byId("mobileUserWork");
    const head=byId("mobileSalesHead");
    if(!nav||!root)return;
    const sales=nav.querySelector('[data-taphoa-work-view="sales"]');
    const orders=nav.querySelector('[data-taphoa-work-view="orders"]');
    const debts=nav.querySelector('[data-taphoa-work-view="debts"]');
    if(sales&&sales.textContent.trim()!=="Bán hàng")sales.textContent="Bán hàng";
    if(orders&&orders.textContent.trim()!=="Đơn")orders.textContent="Đơn";
    if(debts&&debts.textContent.trim()!=="Công nợ")debts.textContent="Công nợ";
    if(head&&nav.nextElementSibling!==head)root.insertBefore(nav,head);
  }

  function cartRowsMarkup(items){
    if(!items.length)return'<div class="mobile-sales-cart-empty">Chưa chọn sản phẩm.</div>';
    return items.map((item,index)=>{
      const row=item?.row||{};
      const url=String(row.canonical_url||"");
      const qty=Math.max(0,Number(item?.qty||0));
      const price=itemPrice(item);
      return '<div class="mobile-sales-cart-row" data-mobile-cart-url="'+attr(url)+'">'+
        '<span class="mobile-sales-cart-name"><small>'+(index+1)+'.</small><strong>'+esc(itemName(item))+'</strong></span>'+ 
        '<b>'+esc(compactMoney(price))+'</b>'+ 
        '<span class="mobile-sales-cart-qty" data-work-url="'+attr(url)+'">'+
          '<button type="button" data-mobile-cart-qty="-1" aria-label="Giảm số lượng">−</button>'+ 
          '<strong>'+qty+'</strong>'+ 
          '<button type="button" data-mobile-cart-qty="1" aria-label="Tăng số lượng">+</button>'+ 
        '</span>'+ 
        '<b class="mobile-sales-cart-line-total">'+esc(compactMoney(price*qty))+'</b>'+ 
      '</div>';
    }).join("");
  }

  function cartActionsMarkup(){
    const editing=Boolean(document.querySelector('[data-order-cart-for="mobileUserSendOrder"].editing'));
    const admin=String(readAuth()?.account?.role||"")==="admin";
    if(editing){
      return '<button type="button" data-order-cart-action="cancel-edit">Hủy</button>'+ 
        '<button type="button" class="primary" data-order-cart-action="update">Cập nhật</button>';
    }
    return '<button type="button" data-order-cart-action="clear">Xóa</button>'+ 
      '<button type="button" id="mobileSalesCartPlace" class="primary">Đặt</button>'+ 
      '<button type="button" class="quick" data-order-cart-action="quick" '+(admin?'':'hidden')+'>Bán</button>';
  }

  function ensureMobileCartSheet(){
    let overlay=byId("mobileSalesCartSheet");
    if(overlay)return overlay;
    overlay=document.createElement("div");
    overlay.id="mobileSalesCartSheet";
    overlay.className="mobile-sales-cart-overlay";
    overlay.hidden=true;
    overlay.setAttribute("aria-hidden","true");
    overlay.innerHTML=
      '<section class="mobile-sales-cart-sheet" role="dialog" aria-modal="true" aria-labelledby="mobileSalesCartTitle">'+
        '<header><div><strong id="mobileSalesCartTitle">Giỏ hàng</strong><small id="mobileSalesCartMeta">0 sản phẩm</small></div><button type="button" data-mobile-cart-close aria-label="Đóng">×</button></header>'+ 
        '<div class="mobile-sales-cart-columns" aria-hidden="true"><span>TÊN</span><span>Đ.GIÁ</span><span>SL</span><span>T.TIỀN</span></div>'+ 
        '<div id="mobileSalesCartRows" class="mobile-sales-cart-rows"></div>'+ 
        '<footer><div class="mobile-sales-cart-summary"><span>Tổng cộng</span><b id="mobileSalesCartGrandTotal">0</b></div><div id="mobileSalesCartActions" class="mobile-sales-cart-actions">'+cartActionsMarkup()+'</div></footer>'+ 
      '</section>';
    document.body.appendChild(overlay);
    return overlay;
  }

  function renderMobileCartSheet(){
    const overlay=ensureMobileCartSheet();
    const info=totals();
    const rows=byId("mobileSalesCartRows");
    const meta=byId("mobileSalesCartMeta");
    const grand=byId("mobileSalesCartGrandTotal");
    const actions=byId("mobileSalesCartActions");
    if(rows)rows.innerHTML=cartRowsMarkup(info.items);
    if(meta)meta.textContent=info.lines+" dòng · "+info.products+" sản phẩm";
    if(grand)grand.textContent=compactMoney(info.total);
    if(actions)actions.innerHTML=cartActionsMarkup();
    overlay.classList.toggle("is-empty",info.lines===0);
  }

  function openCart(){
    if(!mobile()||!salesViewActive())return;
    const overlay=ensureMobileCartSheet();
    renderMobileCartSheet();
    overlay.hidden=false;
    overlay.setAttribute("aria-hidden","false");
    document.documentElement.classList.add("mobile-sales-cart-open");
  }

  function closeCart(){
    const overlay=byId("mobileSalesCartSheet");
    if(!overlay)return;
    overlay.hidden=true;
    overlay.setAttribute("aria-hidden","true");
    document.documentElement.classList.remove("mobile-sales-cart-open");
  }

  function updateMobileSalesSummary(){
    const info=totals();
    const count=byId("mobileSalesCartCount");
    const total=byId("mobileSalesCartTotal");
    if(count)count.textContent=info.lines+" dòng";
    if(total)total.textContent=compactMoney(info.total);
    const overlay=byId("mobileSalesCartSheet");
    if(overlay&&!overlay.hidden){
      if(info.lines===0)closeCart();
      else renderMobileCartSheet();
    }
  }

  function syncVisibility(){
    const head=ensureMobileSalesHead();
    standardizeMobileWorkNav();
    if(head)head.hidden=!mobile()||!salesViewActive();
    if((!mobile()||!salesViewActive())&&!byId("mobileSalesCartSheet")?.hidden)closeCart();
    updateMobileSalesSummary();
  }

  function changeCartQty(button){
    const row=button.closest("[data-mobile-cart-url]");
    const url=String(row?.dataset?.mobileCartUrl||"");
    if(!url||typeof window.userWorkQty!=="function"||typeof window.setUserWorkQty!=="function")return;
    const delta=Number(button.dataset.mobileCartQty||0);
    window.setUserWorkQty(url,window.userWorkQty(url)+delta);
    window.mobileUserScopeViewCache?.delete?.("mine");
    if(typeof window.renderUserWorkHome==="function")window.renderUserWorkHome();
    if(typeof window.updateUserWorkOrderSummary==="function")window.updateUserWorkOrderSummary();
    renderMobileCartSheet();
  }

  function bind(){
    document.addEventListener("click",event=>{
      if(event.target.closest?.("#mobileSalesCartButton")){openCart();return;}
      if(event.target.closest?.("[data-mobile-cart-close]")){closeCart();return;}
      const overlay=event.target.closest?.("#mobileSalesCartSheet");
      if(overlay&&event.target===overlay){closeCart();return;}
      const qty=event.target.closest?.("[data-mobile-cart-qty]");
      if(qty){event.preventDefault();changeCartQty(qty);return;}
      if(event.target.closest?.("#mobileSalesCartPlace")){
        event.preventDefault();
        byId("mobileUserSendOrder")?.click();
        return;
      }
      if(event.target.closest?.("[data-mobile-scope],[data-taphoa-work-view],[data-order-customer-select],[data-order-cart-action]")){
        setTimeout(syncVisibility,0);
      }
    });
    document.addEventListener("getlink-cart-change",()=>setTimeout(updateMobileSalesSummary,0));
    document.addEventListener("getlink-access-change",()=>setTimeout(()=>{syncVisibility();renderMobileCartSheet();},0));
    document.addEventListener("keydown",event=>{if(event.key==="Escape")closeCart();});
    window.addEventListener("resize",syncVisibility);
  }

  function start(){
    ensureMobileSalesHead();
    ensureMobileCartSheet();
    standardizeMobileWorkNav();
    bind();
    syncVisibility();
    if(clockTimer)clearInterval(clockTimer);
    clockTimer=setInterval(updateClock,30000);
  }

  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true});
  else start();
})();
