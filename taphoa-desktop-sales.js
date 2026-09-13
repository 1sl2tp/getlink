(()=>{
  "use strict";

  const QTY_KEY="getlink:user-work-order-qty";
  const NOTE_KEY="getlink:work-order-line-notes-v1";
  const CUSTOMER_KEY="getlink:order-selected-customer";
  const PAGE_SIZE=48;

  let slots=null;
  let active=false;
  let bound=false;
  const state={
    query:"",
    sourceKey:"",
    rows:[],
    visible:PAGE_SIZE,
    qty:new Map(),
    notes:new Map(),
    customers:[],
    selectedCustomerId:"",
    editingOrder:null,
    busy:false,
    status:"",
  };

  function esc(value){return String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]))}
  function attr(value){return esc(value).replace(/`/g,"&#96;")}
  function compactMoney(value){
    const n=Number(value||0);
    if(!Number.isFinite(n)||n<=0)return "—";
    const compact=Math.round(n/500)*.5;
    return new Intl.NumberFormat("vi-VN",{minimumFractionDigits:0,maximumFractionDigits:1}).format(compact);
  }
  function productKey(row){return window.TaphoaDesktopData?.stableProductKey?.(row)||String(row?.canonical_url||"").toLowerCase()}
  function productName(row){
    try{if(typeof canonicalDisplayName==="function")return canonicalDisplayName(row)}catch{}
    return String(row?.source_name||row?.product_name||row?.name||row?.canonical_product_name||"Sản phẩm").trim()||"Sản phẩm";
  }
  function salePrice(row){
    try{
      if(typeof rowPriceLevels==="function"){
        const levels=rowPriceLevels(row)||{};
        return Number(levels.promoCartonPrice||levels.cartonPrice||levels.promoLeafPrice||levels.leafPrice||0);
      }
    }catch{}
    return Number(row?.display_price_vnd||row?.supplier_display_price_vnd||row?.supplier_carton_price_vnd||row?.supplier_retail_price_vnd||row?.current_price||0);
  }
  function qcText(row){
    try{if(typeof rowPrimaryQc==="function"){const value=rowPrimaryQc(row);return value==="—"?"":String(value||"")}}catch{}
    return String(row?.supplier_primary_packaging||row?.supplier_retail_packaging||"").trim();
  }
  function sourceKey(row){return String(row?.supplier_source_key||"").trim()}
  function sourceName(row){return String(row?.supplier_source_name||sourceKey(row)||"Nguồn hàng").trim()||"Nguồn hàng"}

  function readObject(key){
    try{const value=JSON.parse(localStorage.getItem(key)||"{}");return value&&typeof value==="object"?value:{}}catch{return {}}
  }
  function hydrateCart(){
    state.qty.clear();state.notes.clear();
    const qty=readObject(QTY_KEY),notes=readObject(NOTE_KEY);
    for(const [key,value] of Object.entries(qty)){
      const n=Math.max(0,Math.min(999,Math.round(Number(value)||0)));
      if(n)state.qty.set(String(key).toLowerCase(),n);
    }
    for(const [key,value] of Object.entries(notes)){
      const text=String(value||"").replace(/\s+/g," ").trim().slice(0,160);
      if(text)state.notes.set(String(key).toLowerCase(),text);
    }
    state.selectedCustomerId=String(sessionStorage.getItem(CUSTOMER_KEY)||"");
  }
  function persistCart(){
    const qty=Object.fromEntries(state.qty),notes=Object.fromEntries(state.notes);
    try{localStorage.setItem(QTY_KEY,JSON.stringify(qty));localStorage.setItem(NOTE_KEY,JSON.stringify(notes))}catch{}
  }

  function allRows(){return window.TaphoaDesktopData?.allProducts?.()||[]}
  function refreshRows(){
    let rows=window.TaphoaDesktopData?.searchProducts?.(state.query,1000)||[];
    if(state.sourceKey)rows=rows.filter(row=>sourceKey(row)===state.sourceKey);
    state.rows=rows;
    state.visible=Math.min(Math.max(PAGE_SIZE,state.visible),Math.max(PAGE_SIZE,rows.length));
    return rows;
  }

  function renderCategories(){
    if(!slots?.left)return;
    const sources=window.TaphoaDesktopData?.supplierSources?.()||[];
    const total=allRows().length;
    slots.left.innerHTML='<div class="taphoa-column-head"><strong>Danh mục</strong><small>'+total+' sản phẩm</small></div>'+
      '<div class="taphoa-left-list">'+
        '<button type="button" class="taphoa-left-item '+(!state.sourceKey?'active':'')+'" data-sales-source=""><span>Tất cả</span><small>'+total+'</small></button>'+
        sources.map(source=>'<button type="button" class="taphoa-left-item '+(state.sourceKey===source.key?'active':'')+'" data-sales-source="'+attr(source.key)+'"><span>'+esc(source.name)+'</span><small>'+source.count+'</small></button>').join('')+
      '</div>';
  }

  function rowMarkup(row){
    const key=productKey(row),qty=state.qty.get(key)||0,note=state.notes.get(key)||"";
    const image=String(row?.image||"").trim(),price=salePrice(row),qc=qcText(row);
    return '<article class="taphoa-sales-row '+(qty?'is-selected':'')+'" data-sales-product="'+attr(key)+'">'+
      '<div class="taphoa-sales-product">'+
        '<span class="taphoa-sales-thumb">'+(image?'<img src="'+attr(image)+'" alt="" loading="lazy" decoding="async">':'<b>GL</b>')+'</span>'+
        '<span class="taphoa-sales-copy"><strong>'+esc(productName(row))+'</strong><small>'+esc([qc,sourceName(row)].filter(Boolean).join(' · '))+'</small></span>'+
      '</div>'+
      '<strong class="taphoa-sales-price">'+esc(compactMoney(price))+'</strong>'+
      '<div class="taphoa-sales-qty" data-sales-qty-owner="'+attr(key)+'"><button type="button" data-sales-qty="-1" aria-label="Giảm">−</button><b>'+qty+'</b><button type="button" data-sales-qty="1" aria-label="Tăng">+</button></div>'+
      '<input class="taphoa-sales-note" data-sales-note="'+attr(key)+'" maxlength="160" autocomplete="off" placeholder="Ghi chú" value="'+attr(note)+'">'+
    '</article>';
  }

  function manualAddMarkup(){
    const auth=window.TaphoaDesktopData?.readAuth?.();
    if(auth?.account?.role!=="admin"||String(state.query||"").trim().length<2)return '<div class="taphoa-empty">Không có sản phẩm phù hợp.</div>';
    const sources=window.TaphoaDesktopData?.supplierSources?.()||[];
    const preferred=state.sourceKey||sources[0]?.key||"";
    return '<form class="taphoa-manual-add" data-sales-manual-add><div><strong>Không có sản phẩm</strong><small>Thêm trực tiếp vào Tạp hóa</small></div>'+
      '<input name="name" required maxlength="120" value="'+attr(state.query)+'" aria-label="Tên sản phẩm">'+
      '<select name="sourceKey" required aria-label="Nguồn">'+sources.map(source=>'<option value="'+attr(source.key)+'" '+(source.key===preferred?'selected':'')+'>'+esc(source.name)+'</option>').join('')+'</select>'+
      '<input name="priceVnd" inputmode="numeric" required placeholder="Giá bán" aria-label="Giá bán">'+
      '<button type="submit">Thêm mới</button></form>';
  }

  function renderMaster({append=false}={}){
    if(!slots?.master)return;
    refreshRows();
    const visible=state.rows.slice(0,state.visible);
    if(append){
      const list=slots.master.querySelector(".taphoa-sales-list");
      if(list){
        const already=list.children.length;
        list.insertAdjacentHTML("beforeend",visible.slice(already).map(rowMarkup).join(""));
        syncMoreLabel();
        return;
      }
    }
    slots.master.innerHTML='<section class="taphoa-master-frame taphoa-sales-master">'+
      '<header class="taphoa-master-head"><input id="taphoaSalesSearch" type="search" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="Tìm sản phẩm Tạp hóa" value="'+attr(state.query)+'"><small class="taphoa-master-count">'+visible.length+' / '+state.rows.length+'</small></header>'+
      '<div class="taphoa-sales-list">'+(visible.length?visible.map(rowMarkup).join(""):manualAddMarkup())+'</div>'+
      '<div class="taphoa-load-more" data-sales-more '+(visible.length>=state.rows.length?'hidden':'')+'>Cuộn để xem thêm · '+visible.length+' / '+state.rows.length+'</div>'+
    '</section>';
  }
  function syncMoreLabel(){
    const node=slots?.master?.querySelector?.("[data-sales-more]");
    if(!node)return;
    const shown=slots.master.querySelectorAll(".taphoa-sales-row").length;
    node.hidden=shown>=state.rows.length;
    node.textContent='Cuộn để xem thêm · '+shown+' / '+state.rows.length;
    const count=slots.master.querySelector(".taphoa-master-count");
    if(count)count.textContent=shown+' / '+state.rows.length;
  }

  function selectedItems(){
    const out=[];
    for(const [key,qty] of state.qty){
      if(!qty)continue;
      const row=window.TaphoaDesktopData?.findProduct?.(key);
      if(!row)continue;
      out.push({row,key,qty,note:state.notes.get(key)||"",price:salePrice(row)});
    }
    return out;
  }
  function counts(items=selectedItems()){
    return {lines:items.length,products:items.reduce((sum,item)=>sum+Number(item.qty||0),0)};
  }

  function customerControl(auth){
    if(auth?.account?.role!=="admin")return '<div class="taphoa-customer-static"><small>Khách hàng</small><strong>'+esc(auth?.account?.name||auth?.account?.username||"Tài khoản Chat")+'</strong></div>';
    const options=state.customers.map(customer=>'<option value="'+attr(customer.id)+'" '+(String(customer.id)===state.selectedCustomerId?'selected':'')+'>'+esc(customer.name||customer.username||"Khách hàng")+'</option>').join('');
    return '<label class="taphoa-customer-select"><small>Khách hàng</small><select data-sales-customer><option value="">Chọn khách hàng</option>'+options+'</select></label>';
  }

  function renderDetail(){
    if(!slots?.detail)return;
    const auth=window.TaphoaDesktopData?.readAuth?.();
    const items=selectedItems(),summary=counts(items);
    const total=items.reduce((sum,item)=>sum+item.qty*item.price,0);
    const editing=Boolean(state.editingOrder);
    slots.detail.innerHTML='<section class="taphoa-detail-frame taphoa-sales-detail">'+
      '<header class="taphoa-detail-head"><div><strong>'+(editing?'Sửa đơn':'Đơn đang lên')+'</strong><small>'+summary.lines+' dòng · '+summary.products+' sản phẩm</small></div><b>'+esc(compactMoney(total))+'</b></header>'+
      '<div class="taphoa-detail-customer">'+customerControl(auth)+'</div>'+
      '<div class="taphoa-detail-scroll"><div class="taphoa-cart-lines">'+(items.length?items.map((item,index)=>'<div class="taphoa-cart-line"><span><small>'+(index+1)+'.</small><strong>'+esc(productName(item.row))+'</strong>'+(item.note?'<em>'+esc(item.note)+'</em>':'')+'</span><span>'+item.qty+' × '+esc(compactMoney(item.price))+'</span><b>'+esc(compactMoney(item.qty*item.price))+'</b></div>').join(''):'<div class="taphoa-empty">Chưa chọn sản phẩm.</div>')+'</div></div>'+
      '<footer class="taphoa-detail-actions">'+
        (editing?'<button type="button" data-sales-cancel-edit>Hủy</button><button type="button" data-sales-update '+(!items.length||state.busy?'disabled':'')+'>Cập nhật</button>':'<button type="button" data-sales-clear '+(!items.length?'disabled':'')+'>Xóa hàng</button>'+(auth?.account?.role==='admin'?'<button type="button" data-sales-quick '+(!items.length||!state.selectedCustomerId||state.busy?'disabled':'')+'>Bán nhanh</button>':'')+'<button type="button" data-sales-submit '+(!items.length||(auth?.account?.role==='admin'&&!state.selectedCustomerId)||state.busy?'disabled':'')+'>Gửi đơn</button>')+
      '</footer><div class="taphoa-action-status" aria-live="polite">'+esc(state.status)+'</div></section>';
  }

  function updateQtyRow(key,next){
    const row=slots?.master?.querySelector?.('[data-sales-product="'+CSS.escape(key)+'"]');
    if(row){
      row.classList.toggle("is-selected",next>0);
      const value=row.querySelector(".taphoa-sales-qty b");
      if(value)value.textContent=String(next);
    }
    renderDetail();
  }
  function changeQty(key,delta){
    const current=state.qty.get(key)||0;
    const next=Math.max(0,Math.min(999,current+delta));
    if(next)state.qty.set(key,next);else {state.qty.delete(key);state.notes.delete(key);}
    persistCart();
    updateQtyRow(key,next);
  }
  function setNote(key,value){
    const text=String(value||"").replace(/\s+/g," ").trimStart().slice(0,160);
    if(text)state.notes.set(key,text);else state.notes.delete(key);
    persistCart();
    renderDetail();
  }

  function clearCart(){state.qty.clear();state.notes.clear();persistCart();renderMaster();renderDetail()}

  async function loadCustomers(){
    const auth=window.TaphoaDesktopData?.readAuth?.();
    if(auth?.account?.role!=="admin"){state.customers=[];return;}
    try{
      const data=await window.TaphoaDesktopData.orderRequest("/customers",{method:"GET"});
      state.customers=Array.isArray(data?.customers)?data.customers:[];
      if(state.selectedCustomerId&&!state.customers.some(row=>String(row.id)===state.selectedCustomerId)){
        state.selectedCustomerId="";sessionStorage.removeItem(CUSTOMER_KEY);
      }
    }catch{state.customers=[];}
  }

  function orderPayload(){
    return selectedItems().map(item=>({url:String(item.row?.canonical_url||item.row?.url||""),qty:item.qty,bargainPriceVnd:0,lineNote:item.note}));
  }
  async function submitOrder(mode="pending"){
    if(state.busy)return;
    const auth=window.TaphoaDesktopData?.readAuth?.();
    const items=orderPayload();
    if(!auth){state.status="Cần đăng nhập Chat.";renderDetail();return;}
    if(!items.length){state.status="Chưa chọn sản phẩm.";renderDetail();return;}
    if(auth.account?.role==="admin"&&!state.selectedCustomerId){state.status="Chưa chọn khách hàng.";renderDetail();return;}
    state.busy=true;state.status=mode==="quick"?"Đang bán nhanh...":"Đang gửi đơn...";renderDetail();
    try{
      const body={items};
      if(auth.account?.role==="admin")body.customerId=state.selectedCustomerId;
      if(mode==="quick")body.mode="quick";
      const data=await window.TaphoaDesktopData.orderRequest("/orders",{method:"POST",body:JSON.stringify(body)});
      clearCart();
      state.status=(mode==="quick"?"Đã bán nhanh ":"Đã tạo đơn ")+(data?.order?.orderNo?'#'+data.order.orderNo:"");
      document.dispatchEvent(new CustomEvent("taphoa-desktop-orders-changed",{detail:{order:data?.order||null}}));
    }catch(error){state.status=String(error?.message||error);}
    finally{state.busy=false;renderDetail();}
  }

  async function updateEditingOrder(){
    if(state.busy||!state.editingOrder)return;
    const items=orderPayload();
    if(!items.length){state.status="Đơn phải có ít nhất một sản phẩm.";renderDetail();return;}
    state.busy=true;state.status="Đang cập nhật đơn...";renderDetail();
    try{
      const id=String(state.editingOrder.id||"");
      const data=await window.TaphoaDesktopData.orderRequest("/orders/"+encodeURIComponent(id),{method:"PUT",body:JSON.stringify({items})});
      state.editingOrder=null;clearCart();state.status="Đã cập nhật đơn.";
      document.dispatchEvent(new CustomEvent("taphoa-desktop-orders-changed",{detail:{order:data?.order||null}}));
      window.TaphoaDesktopWorkspace?.setView?.("orders");
    }catch(error){state.status=String(error?.message||error);}
    finally{state.busy=false;renderDetail();}
  }

  function editOrder(order){
    if(!order)return false;
    state.editingOrder=order;
    state.qty.clear();state.notes.clear();
    for(const item of Array.isArray(order.items)?order.items:[]){
      const key=String(item.url||"").trim().toLowerCase();
      if(!key)continue;
      const qty=Math.max(0,Math.min(999,Math.round(Number(item.qty)||0)));
      if(qty)state.qty.set(key,qty);
      const note=String(item.note||"").trim().slice(0,160);if(note)state.notes.set(key,note);
    }
    state.selectedCustomerId=String(order.customerId||"");
    if(state.selectedCustomerId)sessionStorage.setItem(CUSTOMER_KEY,state.selectedCustomerId);
    persistCart();
    state.status="Đang sửa đơn #"+String(order.orderNo||order.id||"");
    window.TaphoaDesktopWorkspace?.setView?.("sales");
    if(active){renderMaster();renderDetail();}
    return true;
  }

  function cancelEdit(){state.editingOrder=null;clearCart();state.status="Đã hủy sửa đơn.";renderDetail()}

  async function submitManualAdd(form){
    const name=String(form.elements.name?.value||"").trim();
    const source=String(form.elements.sourceKey?.value||"").trim();
    const price=Number(String(form.elements.priceVnd?.value||"").replace(/\D/g,""));
    const button=form.querySelector("button[type=submit]");
    if(!name||!source||!price)return;
    if(button){button.disabled=true;button.textContent="Đang thêm...";}
    try{
      const data=await window.TaphoaDesktopData.productAddRequest({sourceKey:source,name,priceVnd:price});
      const sourceMeta=(window.TaphoaDesktopData.supplierSources()||[]).find(row=>row.key===source);
      const product={...(data?.product||{}),source:"Tạp hóa",supplier_source_key:source,supplier_source_name:sourceMeta?.name||source};
      window.TaphoaDesktopData.upsertProduct(product);
      state.status="Đã thêm sản phẩm.";state.query=name;state.visible=PAGE_SIZE;
      renderCategories();renderMaster();renderDetail();
    }catch(error){state.status=String(error?.message||error);renderDetail();}
    finally{if(button){button.disabled=false;button.textContent="Thêm mới";}}
  }

  function bindEvents(){
    if(bound||!slots)return;bound=true;
    slots.left.addEventListener("click",event=>{
      const button=event.target.closest?.("[data-sales-source]");if(!button)return;
      state.sourceKey=String(button.dataset.salesSource||"");state.visible=PAGE_SIZE;renderCategories();renderMaster();
    });
    slots.master.addEventListener("input",event=>{
      if(event.target.id==="taphoaSalesSearch"){
        state.query=String(event.target.value||"");state.visible=PAGE_SIZE;renderMaster();return;
      }
      const note=event.target.closest?.("[data-sales-note]");if(note)setNote(String(note.dataset.salesNote||""),note.value);
    });
    slots.master.addEventListener("click",event=>{
      const qty=event.target.closest?.("[data-sales-qty]");if(!qty)return;
      const owner=qty.closest("[data-sales-product]");if(!owner)return;
      changeQty(String(owner.dataset.salesProduct||""),Number(qty.dataset.salesQty)||0);
    });
    slots.master.addEventListener("scroll",()=>{
      const host=slots.master;if(host.scrollHeight-host.scrollTop-host.clientHeight>260)return;
      if(state.visible>=state.rows.length)return;
      state.visible=Math.min(state.rows.length,state.visible+PAGE_SIZE);renderMaster({append:true});
    },{passive:true});
    slots.master.addEventListener("submit",event=>{
      const form=event.target.closest?.("[data-sales-manual-add]");if(!form)return;
      event.preventDefault();void submitManualAdd(form);
    });
    slots.detail.addEventListener("change",event=>{
      const select=event.target.closest?.("[data-sales-customer]");if(!select)return;
      state.selectedCustomerId=String(select.value||"");
      if(state.selectedCustomerId)sessionStorage.setItem(CUSTOMER_KEY,state.selectedCustomerId);else sessionStorage.removeItem(CUSTOMER_KEY);
      renderDetail();
    });
    slots.detail.addEventListener("click",event=>{
      if(event.target.closest?.("[data-sales-clear]")){clearCart();return;}
      if(event.target.closest?.("[data-sales-submit]")){void submitOrder("pending");return;}
      if(event.target.closest?.("[data-sales-quick]")){void submitOrder("quick");return;}
      if(event.target.closest?.("[data-sales-update]")){void updateEditingOrder();return;}
      if(event.target.closest?.("[data-sales-cancel-edit]")){cancelEdit();return;}
    });
  }

  function mount(nextSlots){slots=nextSlots||window.TaphoaDesktopWorkspace?.slots?.();if(!slots)return false;bindEvents();return true;}
  async function activate(){
    if(!mount())return false;active=true;
    window.TaphoaDesktopData?.buildProductIndex?.();hydrateCart();await loadCustomers();
    renderCategories();renderMaster();renderDetail();return true;
  }
  function deactivate(){active=false;}

  window.TaphoaDesktopSales={mount,activate,deactivate,editOrder,renderCategories,renderMaster,renderDetail,updateQtyRow,get selectedItems(){return selectedItems();}};
})();
