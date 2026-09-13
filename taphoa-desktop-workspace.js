(()=>{
  "use strict";

  const VALID_VIEWS=new Set(["sales","orders","debts"]);
  let root=null;
  let currentView="sales";

  function desktopHost(){
    return document.querySelector(".user-work-desktop");
  }

  function mount(){
    if(root?.isConnected)return root;
    if(!window.matchMedia?.("(min-width:1000px)").matches)return null;
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
      setView(String(button.dataset.taphoaView||""));
    });
    return root;
  }

  function syncNav(){
    if(!root)return;
    root.querySelectorAll("[data-taphoa-view]").forEach(button=>{
      const active=String(button.dataset.taphoaView||"")===currentView;
      button.classList.toggle("active",active);
      button.setAttribute("aria-pressed",active?"true":"false");
    });
  }

  function setView(view){
    if(!VALID_VIEWS.has(view))return false;
    const node=mount();
    if(!node)return false;
    currentView=view;
    node.dataset.view=view;
    syncNav();
    document.dispatchEvent(new CustomEvent("taphoa-desktop-view-change",{detail:{view}}));
    return true;
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

  function show(){
    const node=mount();
    if(!node)return false;
    node.hidden=false;
    return true;
  }

  function hide(){
    if(root)root.hidden=true;
  }

  window.TaphoaDesktopWorkspace={
    mount,
    setView,
    slots,
    show,
    hide,
    isActive:()=>Boolean(root?.isConnected&&!root.hidden),
    get view(){return currentView;},
  };
})();
