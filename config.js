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
    if(!document.getElementById("getlinkTaphoaFeedbackCss")){
      const link=document.createElement("link");
      link.id="getlinkTaphoaFeedbackCss";
      link.rel="stylesheet";
      link.href=asset("taphoa-workspace-feedback.css");
      document.head.appendChild(link);
    }
    if(!document.getElementById("getlinkTaphoaOrderWorkspaceV2Css")){
      const link=document.createElement("link");
      link.id="getlinkTaphoaOrderWorkspaceV2Css";
      link.rel="stylesheet";
      link.href=asset("taphoa-order-workspace-v2.css");
      document.head.appendChild(link);
    }
    if(!document.getElementById("getlinkTaphoaFeedbackJs")){
      const script=document.createElement("script");
      script.id="getlinkTaphoaFeedbackJs";
      script.src=asset("taphoa-workspace-feedback.js");
      script.async=false;
      document.head.appendChild(script);
    }
  }catch(error){
    console.debug("Tạp hóa workspace feedback runtime skipped",error);
  }
})();
