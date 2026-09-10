window.GETLINK_API_BASE="https://gcnoahqsrquxkwkjbuxy.supabase.co/functions/v1/getlink-api";
window.GETLINK_API_KEY="sb_publishable_UY3gfQ9MsntDFCUJ_uV0UA__eTYXz_w";

(()=>{
  const build=String(document.querySelector('meta[name="app-build-id"]')?.content||"dev");
  const asset=name=>{
    const url=new URL("./"+name,document.baseURI);
    url.searchParams.set("v",build);
    return url.toString();
  };
  for(const [id,name] of [["getlinkOrderCss","order-management.css"],["getlinkOrderCustomerCss","order-customer-picker.css"]]){
    if(document.getElementById(id))continue;
    const link=document.createElement("link");
    link.id=id;
    link.rel="stylesheet";
    link.href=asset(name);
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
