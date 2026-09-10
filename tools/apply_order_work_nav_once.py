from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
JS = ROOT / "order-management.js"
CSS = ROOT / "order-management.css"

js = JS.read_text(encoding="utf-8")

helpers = r'''  function workManagerNavMarkup(kind){
    return '<nav class="order-work-nav '+kind+'" aria-label="Quản lý mua hàng">'+
      '<span class="order-work-nav-label">Quản lý</span>'+
      '<button type="button" data-order-work-view="orders">Đơn của tôi</button>'+
      '<button type="button" data-order-work-view="debts">Công nợ</button>'+
    '</nav>';
  }
  function syncWorkManagerNav(){
    const admin=currentRole()==="admin";
    document.querySelectorAll('[data-order-work-view="orders"]').forEach(button=>{
      button.textContent=admin?"Đơn hàng":"Đơn của tôi";
    });
    document.querySelectorAll("[data-order-work-view]").forEach(button=>{
      const on=String(button.dataset.orderWorkView)===activeView;
      button.classList.toggle("active",on);
      button.setAttribute("aria-pressed",on?"true":"false");
    });
  }
  function ensureWorkManagerNav(){
    const desktopJump=document.querySelector(".user-work-jump");
    if(desktopJump){
      const desktopTop=desktopJump.closest(".user-work-top");
      if(desktopTop&&!desktopTop.parentElement?.querySelector(".order-work-nav.desktop")){
        desktopTop.insertAdjacentHTML("afterend",workManagerNavMarkup("desktop"));
      }
    }
    const mobileSource=document.querySelector(".mobile-user-source-row");
    if(mobileSource&&!mobileSource.parentElement?.querySelector(".order-work-nav.mobile")){
      mobileSource.insertAdjacentHTML("afterend",workManagerNavMarkup("mobile"));
    }
    syncWorkManagerNav();
  }

'''

inject_anchor = "  function injectUi(){\n    if(document.getElementById(\"orderManager\"))return;\n"
if "function ensureWorkManagerNav()" not in js:
    assert inject_anchor in js, "injectUi anchor changed"
    js = js.replace(
        inject_anchor,
        helpers + "  function injectUi(){\n    ensureWorkManagerNav();\n    if(document.getElementById(\"orderManager\"))return;\n",
        1,
    )

emit_old = '''  function emitAccessChange(){
    document.dispatchEvent(new CustomEvent("getlink-access-change",{detail:accessSnapshot()}));
  }
'''
emit_new = '''  function emitAccessChange(){
    syncWorkManagerNav();
    document.dispatchEvent(new CustomEvent("getlink-access-change",{detail:accessSnapshot()}));
  }
'''
if emit_new not in js:
    assert emit_old in js, "emitAccessChange anchor changed"
    js = js.replace(emit_old, emit_new, 1)

sync_old = '''    const back=document.getElementById("debtBackButton");
    if(back)back.hidden=activeView!=="debts"||currentRole()!=="admin"||!debtCustomerId;
    syncCustomerControls();
'''
sync_new = '''    const back=document.getElementById("debtBackButton");
    if(back)back.hidden=activeView!=="debts"||currentRole()!=="admin"||!debtCustomerId;
    syncWorkManagerNav();
    syncCustomerControls();
'''
if sync_new not in js:
    assert sync_old in js, "syncManagerView anchor changed"
    js = js.replace(sync_old, sync_new, 1)

click_old = '''  document.addEventListener("click",async event=>{
    const target=event.target;
    if(target.closest?.("#orderManagerButton")){if(await requireChatAuth())openManager();return;}
'''
click_new = '''  document.addEventListener("click",async event=>{
    const target=event.target;
    const workView=target.closest?.("[data-order-work-view]");
    if(workView){
      activeView=String(workView.dataset.orderWorkView||"orders");
      if(activeView==="debts"&&currentRole()==="user")debtCustomerId=String(currentAccount()?.id||"");
      else debtCustomerId="";
      debtDetail=null;
      syncManagerView();
      if(await requireChatAuth())openManager();
      return;
    }
    if(target.closest?.("#orderManagerButton")){if(await requireChatAuth())openManager();return;}
'''
if click_new not in js:
    assert click_old in js, "manager click anchor changed"
    js = js.replace(click_old, click_new, 1)

interval_old = '  window.setInterval(()=>{ensureInlineCustomerButtons();syncCustomerControls();},1500);\n'
interval_new = '  window.setInterval(()=>{ensureWorkManagerNav();ensureInlineCustomerButtons();syncCustomerControls();},1500);\n'
if interval_new not in js:
    assert interval_old in js, "runtime maintenance anchor changed"
    js = js.replace(interval_old, interval_new, 1)

JS.write_text(js, encoding="utf-8")

css = CSS.read_text(encoding="utf-8")
marker = "/* Visible order/debt navigation inside Chat Công việc */"
block = r'''

/* Visible order/debt navigation inside Chat Công việc */
.order-work-nav{
  min-height:36px;
  display:flex;
  align-items:center;
  justify-content:flex-end;
  gap:6px;
  padding:4px 0 8px;
}
.order-work-nav-label{
  margin-right:2px;
  color:#7a8491;
  font:650 11px/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
}
.order-work-nav button{
  min-height:32px;
  padding:0 10px;
  border:1px solid #dde3e8;
  border-radius:8px;
  background:#fff;
  color:#4f5b68;
  font:650 12px/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  cursor:pointer;
  white-space:nowrap;
}
.order-work-nav button:hover{background:#f6f8f7}
.order-work-nav button.active{
  border-color:#a7d5bc;
  background:#edf8f2;
  color:#087a40;
}
.order-work-nav.mobile{
  justify-content:flex-start;
  padding:6px 0 0;
}
@media(max-width:639px){
  .order-work-nav{
    width:100%;
    min-height:34px;
    gap:5px;
  }
  .order-work-nav-label{font-size:10.5px}
  .order-work-nav button{
    min-height:30px;
    padding:0 9px;
    font-size:11px;
  }
}
'''
if marker not in css:
    css += block
CSS.write_text(css, encoding="utf-8")

print("Applied visible User/Admin order and debt navigation in Công việc")
