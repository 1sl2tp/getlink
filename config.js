window.GETLINK_API_BASE="https://gcnoahqsrquxkwkjbuxy.supabase.co/functions/v1/getlink-api";
window.GETLINK_API_KEY="sb_publishable_UY3gfQ9MsntDFCUJ_uV0UA__eTYXz_w";

(() => {
  const runtime=window.__GETLINK_BUILD_RUNTIME__||{};
  const build=runtime.activeBuild||Date.now();
  const version=encodeURIComponent(String(build));

  const style=document.createElement("link");
  style.rel="stylesheet";
  style.href="v44-user-hotfix.css?v="+version;
  document.head.appendChild(style);

  let attempts=0;
  const loadPatch=()=>{
    if(typeof window.renderUserWorkHome!=="function"&&typeof renderUserWorkHome!=="function"){
      if(++attempts<100)setTimeout(loadPatch,50);
      return;
    }
    if(document.querySelector('script[data-getlink-v44-hotfix="1"]'))return;
    const script=document.createElement("script");
    script.src="v44-user-hotfix.js?v="+version;
    script.async=false;
    script.dataset.getlinkV44Hotfix="1";
    document.body.appendChild(script);
  };
  setTimeout(loadPatch,0);
})();
