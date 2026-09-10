window.GETLINK_API_BASE="https://gcnoahqsrquxkwkjbuxy.supabase.co/functions/v1/getlink-api";
window.GETLINK_API_KEY="sb_publishable_UY3gfQ9MsntDFCUJ_uV0UA__eTYXz_w";

(()=>{
  const build=String(document.querySelector('meta[name="app-build-id"]')?.content||"dev");
  const asset=name=>{
    const url=new URL("./"+name,document.baseURI);
    url.searchParams.set("v",build);
    return url.toString();
  };
  if(!document.getElementById("getlinkOrderCss")){
    const link=document.createElement("link");
    link.id="getlinkOrderCss";
    link.rel="stylesheet";
    link.href=asset("order-management.css");
    document.head.appendChild(link);
  }
  if(!document.getElementById("getlinkOrderJs")){
    const script=document.createElement("script");
    script.id="getlinkOrderJs";
    script.src=asset("order-management.js");
    script.async=false;
    document.body.appendChild(script);
  }
})();
