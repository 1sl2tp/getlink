(()=>{
  "use strict";

  const MOBILE_QUERY="(max-width: 639px)";
  const ROOT_ID="mobileUserWork";
  const CUSTOMER_ID="mobileStandardCustomer";
  const CART_BAR_ID="mobileStandardCartBar";
  const CART_SHEET_ID="mobileStandardCartSheet";
  const DEBT_SEARCH_ID="mobileStandardDebtSearch";
  const DEBT_AUTH_KEY="getlink:chat-order-auth";
  const DEBT_API_KEY=String(window.GETLINK_API_KEY||"");
  const DEBT_CATALOG_API=String(window.GETLINK_API_BASE||"").replace(/\/+$/,"");
  const DEBT_ORDER_API=DEBT_CATALOG_API.replace(/\/getlink-api$/,"/getlink-orders");
  let mounted=false;
  let cartOpen=false;
  let syncQueued=false;
  let activeDebtCustomerId="";
  let debtActionBusy=false;

  function root(){return document.getElementById(ROOT_ID)}
  function isMobile(){return window.matchMedia(MOBILE_QUERY).matches}
  function clean(value){return String(value??"").replace(/\s+/g," ").trim()}
  function parseCompactVnd(value){
    const text=String(value??"").trim().replace(/\s+/g,"").replace(",",".");
    if(!/^\d+(?:\.\d)?$/.test(text))return null;
    const compact=Number(text);
    if(!Number.isFinite(compact)||compact<=0)return null;
    return Math.round(compact*2)/2*1000;
  }
  function isAdmin(){return String(window.GETLINK_ACCESS_CONTEXT?.snapshot?.()?.state||"")==="admin"}
  function debtAuth(){
    try{
      const value=JSON.parse(sessionStorage.getItem(DEBT_AUTH_KEY)||"null");
      return value?.source==="chat"&&value?.accessToken?value:null;
    }catch{return null;}
  }
  async function debtRequest(path,options={}){
    const auth=debtAuth();
    const headers=new Headers(options.headers||{});
    if(DEBT_API_KEY)headers.set("apikey",DEBT_API_KEY);
    if(auth?.accessToken)headers.set("authorization","Bearer "+auth.accessToken);
    if(options.body)headers.set("content-type","application/json");
    const response=await fetch(DEBT_ORDER_API+path,{...options,headers});
    const data=await response.json().catch(()=>({}));
    if(!response.ok){
      const error=new Error(String(data.error||"Không thực hiện được."));
      error.status=response.status;
      throw error;
    }
    return data;
  }
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
      '<button type="button" class="mobile-standard-customer-selected" data-order-customer-select aria-label="Chọn hoặc đổi khách hàng">Chọn khách</button>'+
    '</section>';
  }

  function cartBarMarkup(){
    return '<section id="'+CART_BAR_ID+'" class="mobile-standard-cart-bar" aria-label="Giỏ hàng và thao tác bán">'+
      '<button type="button" class="mobile-standard-cart-open" data-mobile-standard-action="cart">'+
        '<span>Giỏ <b data-mobile-standard-cart-lines>0</b></span><small><b data-mobile-standard-cart-qty>0</b> SP · <b data-mobile-standard-cart-money>0</b></small>'+
      '</button>'+
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
          '<button type="button" data-mobile-standard-action="clear">Xóa giỏ</button>'+
          '<button type="button" class="primary" data-mobile-standard-action="close">Đóng</button>'+
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
    if(!standard)return;
    const source=document.querySelector('[data-order-customer-for="mobileUserSendOrder"]');
    if(source){
      standard.hidden=source.hidden;
      standard.textContent=clean(source.textContent).replace(/^Khách\s*·\s*/i,"")||"Chọn khách";
      standard.title=source.title||"Chọn khách hàng";
    }else if(!clean(standard.textContent))standard.textContent="Chọn khách";
  }

  function syncCartBar(){
    const bar=document.getElementById(CART_BAR_ID);
    if(!bar)return;
    const items=selectedItems(),sum=totals(items);
    const lines=bar.querySelector("[data-mobile-standard-cart-lines]");
    const qty=bar.querySelector("[data-mobile-standard-cart-qty]");
    const amount=bar.querySelector("[data-mobile-standard-cart-money]");
    if(lines)lines.textContent=String(sum.lines);
    if(qty)qty.textContent=String(sum.qty);
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

  function syncDebtActions(){
    const host=root(),manager=document.getElementById("orderManager");
    if(!host||!manager)return;
    const inDebt=String(host.dataset.taphoaView||"")==="debts";
    const head=manager.querySelector(".debt-detail-head");
    if(!isMobile()||!inDebt||!isAdmin()||!head){
      manager.querySelector("[data-mobile-standard-debt-entry]")?.remove();
      return;
    }

    const legacy=manager.querySelector(".debt-payment-form[data-debt-payment-form]");
    const legacyCustomerId=clean(legacy?.dataset.customerId||"");
    if(legacyCustomerId)activeDebtCustomerId=legacyCustomerId;
    legacy?.remove();
    if(!activeDebtCustomerId)return;

    const balanceText=clean(head.querySelector("b")?.textContent||"");
    const negative=/^[−-]/.test(balanceText);
    const zero=!balanceText||/^[-−]?0(?:[.,]0)?$/.test(balanceText);
    const positive=!negative&&!zero;
    let form=manager.querySelector("[data-mobile-standard-debt-entry]");
    if(!form){
      head.insertAdjacentHTML("afterend",'<form class="debt-payment-form mobile-standard-debt-entry" data-mobile-standard-debt-entry data-customer-id="'+escAttr(activeDebtCustomerId)+'">'+
        '<input name="amountVnd" inputmode="decimal" autocomplete="off" placeholder="Số tiền (nghìn)" aria-label="Số tiền, đơn vị nghìn">'+
        '<input name="note" autocomplete="off" maxlength="160" placeholder="Ghi chú (không bắt buộc)" aria-label="Ghi chú">'+
        '<div style="grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr;gap:7px">'+
          '<button type="submit" data-mobile-debt-action="payment">Thu tiền</button>'+
          '<button type="submit" data-mobile-debt-action="debt" style="border-color:#e5c6b8;background:#fff8f4;color:#8b4a2d">Ghi nợ</button>'+
        '</div>'+
        '<small data-mobile-debt-status style="grid-column:1/-1;color:#697482;font-size:11px"></small>'+
      '</form>');
      form=manager.querySelector("[data-mobile-standard-debt-entry]");
    }
    if(!form)return;
    form.dataset.customerId=activeDebtCustomerId;
    const payment=form.querySelector('[data-mobile-debt-action="payment"]');
    const debt=form.querySelector('[data-mobile-debt-action="debt"]');
    const status=form.querySelector("[data-mobile-debt-status]");
    if(payment){
      payment.disabled=!positive||debtActionBusy;
      payment.style.opacity=payment.disabled?".45":"1";
      payment.style.cursor=payment.disabled?"not-allowed":"pointer";
    }
    if(debt)debt.disabled=debtActionBusy;
    form.querySelectorAll("input").forEach(input=>input.disabled=debtActionBusy);
    if(status&&!debtActionBusy){
      const absolute=balanceText.replace(/^[−-]/,"");
      status.textContent=negative?"Khách đang dư "+absolute:positive?"Khách còn nợ "+balanceText:"Khách không còn nợ";
    }
  }

  async function submitDebtEntry(form,action){
    if(debtActionBusy||!isAdmin())return;
    const customerId=clean(form?.dataset.customerId||activeDebtCustomerId);
    const amountVnd=parseCompactVnd(form?.elements?.amountVnd?.value);
    const status=form?.querySelector("[data-mobile-debt-status]");
    if(!customerId){if(status)status.textContent="Chưa chọn khách hàng.";return;}
    if(!Number.isFinite(amountVnd)||amountVnd<=0){if(status)status.textContent="Nhập số tiền (nghìn).";return;}
    const debt=action==="debt";
    const endpoint=action==="debt"?"adjustments":"payments";
    debtActionBusy=true;
    form.querySelectorAll("input,button").forEach(element=>element.disabled=true);
    if(status)status.textContent=debt?"Đang ghi nợ...":"Đang thu tiền...";
    let failed="";
    try{
      await debtRequest("/debts/"+encodeURIComponent(customerId)+"/"+endpoint,{
        method:"POST",
        body:JSON.stringify({amountVnd:Math.round(amountVnd),note:clean(form.elements.note?.value||"")})
      });
    }catch(error){
      failed=String(error?.message||error||"Không thực hiện được.");
    }
    debtActionBusy=false;
    if(failed){
      syncDebtActions();
      const current=document.querySelector("[data-mobile-standard-debt-entry] [data-mobile-debt-status]");
      if(current)current.textContent=failed;
      return;
    }
    const active=document.querySelector('.taphoa-work-nav.mobile [data-taphoa-work-view="debts"]');
    active?.click();
    queueAfterAsyncOwner();
  }

  function syncView(){
    const host=root();if(!host)return;
    const view=String(host.dataset.taphoaView||"sales");
    const standardCustomer=document.getElementById(CUSTOMER_ID);
    const cartBar=document.getElementById(CART_BAR_ID);
    if(standardCustomer)standardCustomer.hidden=!isMobile()||view!=="sales";
    if(cartBar)cartBar.hidden=!isMobile()||view!=="sales";
    if(view!=="sales"&&cartOpen)closeCart();
    moveWorkNavToBottom();configureOrderTabs();syncDebtSearch();syncDebtActions();
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

  document.addEventListener("click",event=>{
    const debtCustomer=event.target.closest?.("[data-debt-customer-id]");
    if(debtCustomer)activeDebtCustomerId=clean(debtCustomer.dataset.debtCustomerId||"");
    if(event.target.closest?.("#debtBackButton"))activeDebtCustomerId="";
    const workView=event.target.closest?.("[data-taphoa-work-view]");
    if(workView&&String(workView.dataset.taphoaWorkView||"")!=="debts")activeDebtCustomerId="";

    const action=event.target.closest?.("[data-mobile-standard-action]");
    if(action){
      const name=String(action.dataset.mobileStandardAction||"");
      if(name==="cart"){event.preventDefault();openCart();return;}
      if(name==="close"){event.preventDefault();closeCart();return;}
      if(name==="place"){event.preventDefault();if(triggerPlace())closeCart();queueAfterAsyncOwner();return;}
      if(name==="sell"){event.preventDefault();if(triggerSell())closeCart();queueAfterAsyncOwner();return;}
      if(name==="clear"){event.preventDefault();triggerClear();queueAfterAsyncOwner();return;}
    }
    if(event.target.closest?.("[data-work-qty],[data-taphoa-work-view],[data-order-status],[data-debt-customer-id],[data-debt-order-back],[data-debt-order-id],[data-order-customer-select]"))queueAfterAsyncOwner();
  });

  document.addEventListener("submit",event=>{
    const form=event.target.closest?.("[data-mobile-standard-debt-entry]");
    if(!form)return;
    event.preventDefault();
    const action=String(event.submitter?.dataset.mobileDebtAction||"");
    if(action!=="payment"&&action!=="debt")return;
    void submitDebtEntry(form,action);
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
