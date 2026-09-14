(()=>{
  "use strict";

  const MOBILE_QUERY="(max-width: 639px)";
  const ROOT_ID="mobileUserWork";
  const CUSTOMER_ID="mobileStandardCustomer";
  const CART_BAR_ID="mobileStandardCartBar";
  const CART_SHEET_ID="mobileStandardCartSheet";
  const DEBT_SEARCH_ID="mobileStandardDebtSearch";
  let mounted=false;
  let cartOpen=false;
  let syncQueued=false;

  function root(){return document.getElementById(ROOT_ID)}
  function isMobile(){return window.matchMedia(MOBILE_QUERY).matches}
  function clean(value){return String(value??"").replace(/\s+/g," ").trim()}
  function normalized(value){
    return clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/đ/g,"d").replace(/Đ/g,"D").toLowerCase();
  }
  function esc(value){
    return String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  }
  function escAttr(value){return esc(value).replace(/`/g,"&#96;")}
  function money(value){
    const n=Math.max(0,Number(value)||0);
    return new Intl.NumberFormat("vi-VN",{maximumFractionDigits:0}).format(Math.round(n));
  }
  function selectedItems(){
    if(typeof window.userWorkSelectedItems!=="function")return [];
    const rows=window.userWorkSelectedItems();
    return Array.isArray(rows)?rows:[];
  }
  function itemName(item){
    const row=item?.row||{};
    return clean(row.product_name||row.name||row.source_name||row.canonical_name||row.canonical_url||"Sản phẩm");
  }
  function itemUrl(item){return clean(item?.row?.canonical_url||"")}
  function itemPrice(item){
    const row=item?.row||{};
    const bargain=Math.max(0,Number(item?.bargain)||0);
    if(bargain>0)return bargain;
    return Math.max(0,Number(row.current_price||row.regular_pack_price||row.my_price||0)||0);
  }
  function totals(items=selectedItems()){
    return items.reduce((out,item)=>{
      const qty=Math.max(0,Number(item?.qty)||0);
      out.lines+=qty>0?1:0;
      out.qty+=qty;
      out.money+=qty*itemPrice(item);
      return out;
    },{lines:0,qty:0,money:0});
  }
  function visible(element){
    if(!element||element.hidden)return false;
    const style=getComputedStyle(element);
    return style.display!=="none"&&style.visibility!=="hidden";
  }

  function customerMarkup(){
    return '<section id="'+CUSTOMER_ID+'" class="mobile-standard-customer" aria-label="Khách hàng">'+
      '<button type="button" class="mobile-standard-customer-search" data-mobile-standard-action="customer-search">Tìm khách: tên / SĐT / mã</button>'+
      '<button type="button" class="mobile-standard-customer-selected" data-order-customer-select aria-label="Khách đã chọn">Chọn khách</button>'+
    '</section>';
  }

  function cartBarMarkup(){
    return '<section id="'+CART_BAR_ID+'" class="mobile-standard-cart-bar" aria-label="Giỏ hàng và thao tác bán">'+
      '<button type="button" class="mobile-standard-cart-open" data-mobile-standard-action="cart">'+
        '<span>Giỏ <b data-mobile-standard-cart-qty>0</b></span><small data-mobile-standard-cart-money>0</small>'+
      '</button>'+
      '<div class="mobile-standard-cart-total" aria-label="Tổng số lượng"><small>SL</small><strong data-mobile-standard-total-qty>0</strong></div>'+
      '<button type="button" class="mobile-standard-place" data-mobile-standard-action="place">Đặt</button>'+
      '<button type="button" class="mobile-standard-sell" data-mobile-standard-action="sell">Bán</button>'+
    '</section>';
  }

  function cartSheetMarkup(){
    return '<section id="'+CART_SHEET_ID+'" class="mobile-standard-cart-sheet" hidden aria-hidden="true">'+
      '<button type="button" class="mobile-standard-cart-backdrop" data-mobile-standard-action="close" aria-label="Đóng giỏ"></button>'+
      '<section class="mobile-standard-cart-card" role="dialog" aria-modal="true" aria-label="Giỏ hàng">'+
        '<header class="mobile-standard-cart-head"><div><strong>Giỏ hàng</strong><small data-mobile-standard-sheet-summary>0 sản phẩm</small></div><button type="button" data-mobile-standard-action="close" aria-label="Đóng">×</button></header>'+
        '<div class="mobile-standard-cart-columns" aria-hidden="true"><span>Sản phẩm</span><span>Đơn giá</span><span>SL</span><span>Thành tiền</span></div>'+
        '<div class="mobile-standard-cart-lines" data-mobile-standard-cart-lines></div>'+
        '<div class="mobile-standard-cart-grand"><span><small data-mobile-standard-sheet-qty>0 sản phẩm</small><strong>Tổng tiền</strong></span><b data-mobile-standard-sheet-money>0</b></div>'+
        '<footer class="mobile-standard-cart-actions">'+
          '<button type="button" data-mobile-standard-action="clear">Xóa</button>'+
          '<button type="button" data-mobile-standard-action="place">Đặt</button>'+
          '<button type="button" class="primary" data-mobile-standard-action="sell">Bán</button>'+
        '</footer>'+
      '</section>'+
    '</section>';
  }

  function debtSearchMarkup(){
    return '<section id="'+DEBT_SEARCH_ID+'" class="mobile-standard-debt-search" hidden>'+
      '<label><span class="sr-only">Tìm công nợ</span><input type="search" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="Tìm tên / tài khoản"></label>'+
      '<button type="button" data-mobile-standard-debt-refresh>↻</button>'+
    '</section>';
  }

  function mountMobileStandard(){
    const host=root();
    if(!host)return false;
    if(!document.getElementById(CUSTOMER_ID)){
      const toolbar=host.querySelector(".mobile-user-toolbar");
      toolbar?.insertAdjacentHTML("beforebegin",customerMarkup());
    }
    if(!document.getElementById(CART_BAR_ID))host.insertAdjacentHTML("beforeend",cartBarMarkup());
    if(!document.getElementById(CART_SHEET_ID))document.body.insertAdjacentHTML("beforeend",cartSheetMarkup());
    const manager=document.getElementById("orderManager");
    if(manager&&!document.getElementById(DEBT_SEARCH_ID)){
      const body=manager.querySelector("#orderManagerBody");
      const tabs=manager.querySelector("#orderManagerTabs");
      (tabs||body?.firstElementChild)?.insertAdjacentHTML("beforebegin",debtSearchMarkup());
    }
    moveWorkNavToBottom();
    configureOrderTabs();
    mounted=true;
    syncAll();
    return true;
  }

  function moveWorkNavToBottom(){
    const host=root();
    const nav=host?.querySelector(".taphoa-work-nav.mobile");
    if(!host||!nav)return false;
    nav.classList.add("mobile-standard-nav-bottom");
    return true;
  }

  function configureOrderTabs(){
    const orderTabs=document.getElementById("orderManagerTabs");
    const pending=orderTabs?.querySelector('[data-order-status="pending"]');
    const delivered=orderTabs?.querySelector('[data-order-status="delivered"]');
    if(orderTabs&&pending&&delivered&&delivered.nextElementSibling!==pending){
      orderTabs.insertBefore(delivered,pending);
    }
  }


  function syncCustomer(){
    const standard=document.querySelector("#"+CUSTOMER_ID+" [data-order-customer-select]");
    const search=document.querySelector("#"+CUSTOMER_ID+" [data-mobile-standard-action=\"customer-search\"]");
    if(!standard)return;
    const source=document.querySelector('[data-order-customer-for="mobileUserSendOrder"]');
    if(source){
      standard.hidden=source.hidden;
      standard.textContent=clean(source.textContent).replace(/^Khách\s*·\s*/i,"")||"Chọn khách";
      standard.title=source.title||"Chọn khách hàng";
    }else if(!clean(standard.textContent))standard.textContent="Chọn khách";
    if(search)search.hidden=standard.hidden;
  }

  function syncCartBar(){
    const bar=document.getElementById(CART_BAR_ID);
    if(!bar)return;
    const items=selectedItems(),sum=totals(items);
    const qty=bar.querySelector("[data-mobile-standard-cart-qty]");
    const totalQty=bar.querySelector("[data-mobile-standard-total-qty]");
    const amount=bar.querySelector("[data-mobile-standard-cart-money]");
    if(qty)qty.textContent=String(sum.qty);
    if(totalQty)totalQty.textContent=String(sum.qty);
    if(amount)amount.textContent=money(sum.money);
    bar.classList.toggle("has-items",sum.qty>0);

    const place=bar.querySelector('[data-mobile-standard-action="place"]');
    const sell=bar.querySelector('[data-mobile-standard-action="sell"]');
    const update=document.querySelector('[data-order-cart-for="mobileUserSendOrder"] [data-order-cart-action="update"]');
    const quick=document.querySelector('[data-order-cart-for="mobileUserSendOrder"] [data-order-cart-action="quick"]');
    const editing=visible(update);
    if(place){place.textContent=editing?"Cập nhật":"Đặt";place.disabled=sum.qty===0;}
    if(sell){sell.hidden=editing||!quick||quick.hidden;sell.disabled=sum.qty===0;}
  }

  function renderCartSheet(){
    const sheet=document.getElementById(CART_SHEET_ID);
    if(!sheet)return;
    const items=selectedItems(),sum=totals(items);
    const lines=sheet.querySelector("[data-mobile-standard-cart-lines]");
    if(lines){
      lines.innerHTML=items.length?items.map((item,index)=>{
        const qty=Math.max(0,Number(item.qty)||0),price=itemPrice(item),url=itemUrl(item);
        return '<div class="mobile-standard-cart-line">'+
          '<span class="mobile-standard-cart-product"><small>'+(index+1)+'.</small><strong>'+esc(itemName(item))+'</strong></span>'+
          '<b class="mobile-standard-cart-price">'+esc(money(price))+'</b>'+
          '<span class="mobile-standard-cart-qty" data-work-url="'+escAttr(url)+'"><button type="button" data-work-qty="-1" aria-label="Giảm số lượng">−</button><b>'+qty+'</b><button type="button" data-work-qty="1" aria-label="Tăng số lượng">+</button></span>'+
          '<strong class="mobile-standard-cart-line-total">'+esc(money(qty*price))+'</strong>'+
        '</div>';
      }).join(""):'<div class="mobile-standard-cart-empty">Chưa chọn sản phẩm.</div>';
    }
    const summary=sheet.querySelector("[data-mobile-standard-sheet-summary]");
    const qty=sheet.querySelector("[data-mobile-standard-sheet-qty]");
    const amount=sheet.querySelector("[data-mobile-standard-sheet-money]");
    if(summary)summary.textContent=sum.lines+" dòng · "+sum.qty+" sản phẩm";
    if(qty)qty.textContent=sum.qty+" sản phẩm";
    if(amount)amount.textContent=money(sum.money);
    sheet.querySelectorAll('[data-mobile-standard-action="place"],[data-mobile-standard-action="sell"]').forEach(button=>button.disabled=sum.qty===0);
    const quick=document.querySelector('[data-order-cart-for="mobileUserSendOrder"] [data-order-cart-action="quick"]');
    const update=document.querySelector('[data-order-cart-for="mobileUserSendOrder"] [data-order-cart-action="update"]');
    const editing=visible(update);
    const place=sheet.querySelector('[data-mobile-standard-action="place"]');
    const sell=sheet.querySelector('[data-mobile-standard-action="sell"]');
    if(place)place.textContent=editing?"Cập nhật":"Đặt";
    if(sell)sell.hidden=editing||!quick||quick.hidden;
  }

  function openCart(){
    const sheet=document.getElementById(CART_SHEET_ID);if(!sheet)return;
    cartOpen=true;renderCartSheet();sheet.hidden=false;sheet.setAttribute("aria-hidden","false");document.documentElement.classList.add("mobile-standard-cart-open");
  }
  function closeCart(){
    const sheet=document.getElementById(CART_SHEET_ID);if(!sheet)return;
    cartOpen=false;sheet.hidden=true;sheet.setAttribute("aria-hidden","true");document.documentElement.classList.remove("mobile-standard-cart-open");
  }

  function clickExisting(selector){
    const target=document.querySelector(selector);
    if(!target)return false;
    target.click();
    return true;
  }
  function triggerPlace(){
    const update=document.querySelector('[data-order-cart-for="mobileUserSendOrder"] [data-order-cart-action="update"]');
    if(visible(update))return clickExisting('[data-order-cart-for="mobileUserSendOrder"] [data-order-cart-action="update"]');
    return clickExisting("#mobileUserSendOrder");
  }
  function triggerSell(){return clickExisting('[data-order-cart-for="mobileUserSendOrder"] [data-order-cart-action="quick"]')}
  function triggerClear(){return clickExisting('[data-order-cart-for="mobileUserSendOrder"] [data-order-cart-action="clear"]')}

  function syncDebtSearch(){
    const search=document.getElementById(DEBT_SEARCH_ID);if(!search)return;
    const host=root();
    const inDebt=host?.dataset.taphoaView==="debts";
    const manager=document.getElementById("orderManager");
    const inDetail=Boolean(manager?.querySelector(".debt-detail-head,.debt-timeline,.debt-linked-order"));
    search.hidden=!isMobile()||!inDebt||inDetail;
    if(search.hidden)return;
    const input=search.querySelector("input");
    const query=normalized(input?.value||"");
    manager?.querySelectorAll(".debt-customer-card").forEach(card=>{
      card.hidden=Boolean(query&&!normalized(card.textContent).includes(query));
    });
  }

  function syncView(){
    const host=root();if(!host)return;
    const view=String(host.dataset.taphoaView||"sales");
    const standardCustomer=document.getElementById(CUSTOMER_ID);
    const cartBar=document.getElementById(CART_BAR_ID);
    if(standardCustomer)standardCustomer.hidden=!isMobile()||view!=="sales";
    if(cartBar)cartBar.hidden=!isMobile()||view!=="sales";
    if(view!=="sales"&&cartOpen)closeCart();
    moveWorkNavToBottom();configureOrderTabs();syncDebtSearch();
  }

  function syncAll(){
    if(!mounted&& !mountMobileStandard())return;
    syncCustomer();syncCartBar();if(cartOpen)renderCartSheet();syncView();
  }
  function queueSync(delay=0){
    if(delay>0){window.setTimeout(syncAll,delay);return;}
    if(syncQueued)return;syncQueued=true;
    queueMicrotask(()=>{syncQueued=false;syncAll();});
  }
  function queueAfterAsyncOwner(){
    queueSync();queueSync(80);queueSync(320);queueSync(1000);
  }

  const IFRAME_TAP_SELECTOR="#mobileUserWork button,#mobileUserWork [role=\"button\"],#mobileUserWork .order-card[data-order-id],#mobileStandardCartSheet button,#orderCustomerPicker button";
  let iframePointerTap=null;
  let iframeSyntheticGuard=null;
  function iframeTapFallbackEnabled(){return isMobile()&&window.parent!==window}
  document.addEventListener("pointerdown",event=>{
    if(!iframeTapFallbackEnabled()||(event.pointerType!=="touch"&&event.pointerType!=="pen"))return;
    const target=event.target.closest?.(IFRAME_TAP_SELECTOR);
    if(!target||target.disabled)return;
    iframePointerTap={pointerId:event.pointerId,target,x:event.clientX,y:event.clientY,at:Date.now()};
  },true);
  document.addEventListener("pointerup",event=>{
    const tap=iframePointerTap;
    iframePointerTap=null;
    if(!tap||tap.pointerId!==event.pointerId||!tap.target.isConnected)return;
    const moved=Math.hypot(event.clientX-tap.x,event.clientY-tap.y);
    if(moved>10||Date.now()-tap.at>800)return;
    event.preventDefault();
    event.stopPropagation();
    iframeSyntheticGuard={target:tap.target,until:performance.now()+700};
    tap.target.click();
  },true);
  document.addEventListener("pointercancel",()=>{iframePointerTap=null;},true);
  document.addEventListener("click",event=>{
    const guard=iframeSyntheticGuard;
    if(!guard||performance.now()>guard.until){iframeSyntheticGuard=null;return;}
    const target=event.target.closest?.(IFRAME_TAP_SELECTOR);
    if(event.isTrusted&&target===guard.target){
      event.preventDefault();
      event.stopImmediatePropagation();
      iframeSyntheticGuard=null;
    }
  },true);

  document.addEventListener("click",event=>{
    const action=event.target.closest?.("[data-mobile-standard-action]");
    if(action){
      const name=String(action.dataset.mobileStandardAction||"");
      if(name==="customer-search"){
        event.preventDefault();
        const picker=window.GETLINK_ORDER_UI?.openCustomerPicker;
        if(typeof picker==="function")void picker();
        queueAfterAsyncOwner();
        return;
      }
      if(name==="cart"){event.preventDefault();openCart();return;}
      if(name==="close"){event.preventDefault();closeCart();return;}
      if(name==="place"){event.preventDefault();if(triggerPlace())closeCart();queueAfterAsyncOwner();return;}
      if(name==="sell"){event.preventDefault();if(triggerSell())closeCart();queueAfterAsyncOwner();return;}
      if(name==="clear"){event.preventDefault();triggerClear();queueAfterAsyncOwner();return;}
    }
    if(event.target.closest?.("[data-work-qty],[data-taphoa-work-view],[data-order-status],[data-debt-customer-id],[data-debt-order-back],[data-debt-order-id],[data-order-customer-select]"))queueAfterAsyncOwner();
  });

  document.addEventListener("input",event=>{
    if(event.target?.closest?.("#"+DEBT_SEARCH_ID)){syncDebtSearch();return;}
    if(event.target?.id==="mobileUserSearch")queueSync();
  });

  document.addEventListener("change",event=>{
    if(event.target?.closest?.(".order-report-controls"))queueAfterAsyncOwner();
  });

  document.addEventListener("getlink-access-change",()=>queueAfterAsyncOwner());
  window.addEventListener("resize",()=>queueSync());
  window.addEventListener("pageshow",()=>queueAfterAsyncOwner());
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")queueAfterAsyncOwner();});

  document.addEventListener("click",event=>{
    if(event.target?.closest?.("[data-mobile-standard-debt-refresh]")){
      event.preventDefault();
      const active=document.querySelector('.taphoa-work-nav.mobile [data-taphoa-work-view="debts"]');
      active?.click();queueAfterAsyncOwner();
    }
  });

  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",mountMobileStandard,{once:true});
  else mountMobileStandard();
})();
