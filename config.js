window.GETLINK_API_BASE="https://gcnoahqsrquxkwkjbuxy.supabase.co/functions/v1/getlink-api";
window.GETLINK_API_KEY="sb_publishable_UY3gfQ9MsntDFCUJ_uV0UA__eTYXz_w";

(()=>{
  try{
    const source=new URL(document.currentScript?.src||location.href,location.href);
    const version=source.searchParams.get("v")||"";
    const asset=name=>{
      const url=new URL(name,source);
      if(version)url.searchParams.set("v",version);
      return url.toString();
    };
    const addStyle=(id,name)=>{
      if(document.getElementById(id))return;
      const link=document.createElement("link");
      link.id=id;link.rel="stylesheet";link.href=asset(name);
      document.head.appendChild(link);
    };
    const addScript=(id,name)=>{
      if(document.getElementById(id))return;
      const script=document.createElement("script");
      script.id=id;script.src=asset(name);script.async=false;
      document.head.appendChild(script);
    };

    addStyle("getlinkTaphoaDesktopWorkspaceCss","taphoa-desktop-workspace.css");
    addScript("getlinkTaphoaDesktopWorkspaceJs","taphoa-desktop-workspace.js");
    addScript("getlinkTaphoaDesktopDataJs","taphoa-desktop-data.js");
    addScript("getlinkTaphoaDesktopSalesJs","taphoa-desktop-sales.js");
    addScript("getlinkTaphoaDesktopOrdersJs","taphoa-desktop-orders.js");
    addScript("getlinkTaphoaDesktopDebtsJs","taphoa-desktop-debts.js");

    const loadLegacyMobile=()=>{
      addStyle("getlinkTaphoaHotPathCss","taphoa-hot-path-runtime.css");
      addStyle("getlinkTaphoaFeedbackCss","taphoa-workspace-feedback.css");
      addStyle("getlinkTaphoaOrderWorkspaceV2Css","taphoa-order-workspace-v2.css");
      addScript("getlinkTaphoaHotPathJs","taphoa-hot-path-runtime.js");
      addScript("getlinkTaphoaFeedbackJs","taphoa-workspace-feedback.js");
    };
    const mobileMedia=window.matchMedia?.("(max-width:999px)");
    if(!mobileMedia||mobileMedia.matches)loadLegacyMobile();
    mobileMedia?.addEventListener?.("change",event=>{if(event.matches)loadLegacyMobile();});
  }catch(error){
    console.debug("Tạp hóa workspace runtime skipped",error);
  }
})();
