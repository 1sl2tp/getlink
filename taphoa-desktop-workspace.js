(()=>{
  "use strict";

  const VALID_VIEWS=new Set(["sales","orders","debts"]);
  let root=null;
  let currentView="sales";
  let currentModule=null;
  let resizeTimer=0;
  let startTimer=0;

  function desktopHost(){return document.querySelector(".user-work-desktop")}
  function isDesktop(){return Boolean(window.matchMedia?.("(min-width:1000px)").matches)}
  function moduleFor(view){
    if(view==="sales")return window.TaphoaDesktopSales||null;
    if(view==="orders")return window.TaphoaDesktopOrders||null;
    if(view==="debts")return window.TaphoaDesktopDebts||null;
    return null;
  }
  function dependenciesReady(){
    return Boolean(window.TaphoaDesktopData&&window.TaphoaDesktopSales&&window.TaphoaDesktopOrders&&window.TaphoaDesktopDebts);
  }
  function isTaphoaSelected(){
    if(!isDesktop())return false;
    const home=document.getElementById("userWorkHome");
    if(!home||home.hidden)return false;
    const button=document.querySelector('.user-work-jump-button.active,.user-work-jump-button[aria-pressed="true"]');
    return !button||String(button.dataset.workTarget||"mine")==="mine";
  }

  function mount(){
    if(root?.isConnected)return root;
    if(!isDesktop())return null;
    const host=desktopHost();
    if(!host)return null;

    root=document.createElement("section");
    root.id="taphoaDesktopWorkspace";
    root.className="taphoa-desktop-workspace";
    root.dataset.view=currentView;
    root.hidden=true;
    root.innerHTML=`
      <aside id="taphoaLeftRail" class="taphoa-desktop-column taphoa-left-rail" aria-label="Điều hướng Tạp hóa"></aside>
      <main id="taphoaMasterList" class="taphoa-desktop-column taphoa-master-list"></main>
      <aside id="taphoaDetailPane" class="taphoa-desktop-column taphoa-detail-pane" aria-label="Chi tiết Tạp hóa"></aside>
      <nav id="taphoaBottomNav" class="taphoa-desktop-bottom-nav" aria-label="Tạp hóa">
        <button type="button" data-taphoa-view="sales" aria-pressed="true">Bán</button>
        <button type="button" data-taphoa-view="orders" aria-pressed="false">Đơn</button>
        <button type="button" data-taphoa-view="debts" aria-pressed="false">Công nợ</button>
      </nav>`;
    host.appendChild(root);

    root.querySelector("#taphoaBottomNav")?.addEventListener("click",event=>{
      const button=event.target.closest?.("[data-taphoa-view]");
      if(!button)return;
      void activateView(String(button.dataset.taphoaView||""));
    });
    return root;
  }

  function syncNav(){
    if(!root)return;
    root.querySelectorAll("[data-taphoa-view]").forEach(button=>{
      const selected=String(button.dataset.taphoaView||"")===currentView;
      button.classList.toggle("active",selected);
      button.setAttribute("aria-pressed",selected?"true":"false");
    });
  }

  function slots(){
    const node=mount();
    if(!node)return null;
    return {
      left:node.querySelector("#taphoaLeftRail"),
      master:node.querySelector("#taphoaMasterList"),
      detail:node.querySelector("#taphoaDetailPane"),
    };
  }

  function clearSlots(){
    const owned=slots();
    if(!owned)return;
    owned.left.innerHTML="";
    owned.master.innerHTML="";
    owned.detail.innerHTML="";
  }

  function show(){
    const node=mount();
    const host=desktopHost();
    if(!node||!host)return false;
    host.classList.add("taphoa-new-desktop-active");
    node.hidden=false;
    return true;
  }

  function hide(){
    currentModule?.deactivate?.();
    currentModule=null;
    const host=desktopHost();
    if(host)host.classList.remove("taphoa-new-desktop-active");
    if(root)root.hidden=true;
  }

  async function activateView(view){
    if(!VALID_VIEWS.has(view)||!isTaphoaSelected()||!dependenciesReady())return false;
    const node=mount();
    if(!node||!show())return false;
    const nextModule=moduleFor(view);
    if(!nextModule)return false;

    if(currentModule&&currentModule!==nextModule)currentModule.deactivate?.();
    const changed=currentView!==view||currentModule!==nextModule;
    currentView=view;
    currentModule=nextModule;
    node.dataset.view=view;
    syncNav();
    if(changed)clearSlots();
    await nextModule.activate?.();
    document.dispatchEvent(new CustomEvent("taphoa-desktop-view-change",{detail:{view}}));
    return true;
  }

  function setView(view){
    if(!VALID_VIEWS.has(view))return false;
    void activateView(view);
    return true;
  }

  function syncFromTopNavigation(){
    if(!isDesktop()||!isTaphoaSelected()){hide();return;}
    if(dependenciesReady())void activateView(currentView);
  }

  function start(){
    if(startTimer)return;
    let attempts=0;
    startTimer=window.setInterval(()=>{
      attempts+=1;
      if(dependenciesReady()&&desktopHost()&&document.getElementById("userWorkHome")){
        window.clearInterval(startTimer);startTimer=0;syncFromTopNavigation();return;
      }
      if(attempts>200){window.clearInterval(startTimer);startTimer=0;}
    },25);
  }

  document.addEventListener("click",event=>{
    const target=event.target.closest?.(".user-work-jump-button[data-work-target]");
    if(!target)return;
    window.requestAnimationFrame(syncFromTopNavigation);
  },true);

  // This listener is registered before legacy order-management.js. New slot handlers
  // already ran while the event bubbled; stop the old document-level handlers here.
  document.addEventListener("click",event=>{
    if(!root||root.hidden)return;
    if(event.target.closest?.("#taphoaDesktopWorkspace"))event.stopImmediatePropagation();
  });

  document.addEventListener("getlink-access-change",()=>{
    if(root&&!root.hidden&&dependenciesReady())void activateView(currentView);
  });

  window.addEventListener("resize",()=>{
    window.clearTimeout(resizeTimer);
    resizeTimer=window.setTimeout(syncFromTopNavigation,120);
  },{passive:true});

  window.TaphoaDesktopWorkspace={
    mount,
    setView,
    activateView,
    slots,
    show,
    hide,
    start,
    isActive:()=>Boolean(root?.isConnected&&!root.hidden&&desktopHost()?.classList.contains("taphoa-new-desktop-active")),
    get view(){return currentView;},
  };

  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true});
  else start();
})();
