from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# 1) config.js owns configuration only; it must not inject runtime modules.
config_path = ROOT / "config.js"
config = config_path.read_text(encoding="utf-8")
config_prefix = (
    'window.GETLINK_API_BASE="https://gcnoahqsrquxkwkjbuxy.supabase.co/functions/v1/getlink-api";\n'
    'window.GETLINK_API_KEY="sb_publishable_UY3gfQ9MsntDFCUJ_uV0UA__eTYXz_w";\n'
)
assert config.startswith(config_prefix), "unexpected config.js header"
config_path.write_text(config_prefix, encoding="utf-8")

# 2) app.js explicitly exposes the live Tạp hóa cart/read/render boundary used by order-management.js.
app_path = ROOT / "app.js"
app = app_path.read_text(encoding="utf-8")
exports = (
    'window.userWorkSelectedItems=userWorkSelectedItems;\n'
    'window.renderUserWorkHome=renderUserWorkHome;\n'
    'window.updateUserWorkOrderSummary=updateUserWorkOrderSummary;\n\n'
)
anchor = 'startClassificationAutoRefresh();\n'
if exports not in app:
    assert app.count(anchor) == 1, "unexpected app export anchor"
    app = app.replace(anchor, exports + anchor, 1)
app_path.write_text(app, encoding="utf-8")

# 3) index.html is the single bootstrap owner. Config -> app -> order styles -> order JS.
index_path = ROOT / "index.html"
index = index_path.read_text(encoding="utf-8")
old = '''(async()=>{\n  const runtime=window.__GETLINK_BUILD_RUNTIME__;\n  const build=runtime&&runtime.activeBuild||document.querySelector('meta[name="app-build-id"]')?.content||"dev";\n  const loadScript=runtime&&runtime.loadScript;\n  if(!loadScript)return;\n  try{\n    const configUrl=runtime.assetUrl("config.js",build);\n    const appUrl=runtime.assetUrl("app.js",build);\n    await loadScript(configUrl,build);\n    await loadScript(appUrl,build);\n  }catch(error){\n    console.error("GETLINK bootstrap failed",error);\n  }\n})();'''
new = '''(async()=>{\n  const runtime=window.__GETLINK_BUILD_RUNTIME__;\n  const build=runtime&&runtime.activeBuild||document.querySelector('meta[name="app-build-id"]')?.content||"dev";\n  const loadScript=runtime&&runtime.loadScript;\n  if(!loadScript)return;\n  const loadStyle=(id,url)=>new Promise((resolve,reject)=>{\n    const existing=document.getElementById(id);\n    if(existing){resolve();return;}\n    const link=document.createElement("link");\n    link.id=id;\n    link.rel="stylesheet";\n    link.href=url;\n    link.onload=()=>resolve();\n    link.onerror=()=>reject(new Error("Không tải được "+url));\n    document.head.appendChild(link);\n  });\n  try{\n    const configUrl=runtime.assetUrl("config.js",build);\n    const appUrl=runtime.assetUrl("app.js",build);\n    const orderCssUrl=runtime.assetUrl("order-management.css",build);\n    const orderCustomerCssUrl=runtime.assetUrl("order-customer-picker.css",build);\n    const orderManagementUrl=runtime.assetUrl("order-management.js",build);\n    await loadScript(configUrl,build);\n    await loadScript(appUrl,build);\n    await Promise.all([\n      loadStyle("getlinkOrderCss",orderCssUrl),\n      loadStyle("getlinkOrderCustomerCss",orderCustomerCssUrl)\n    ]);\n    await loadScript(orderManagementUrl,build);\n  }catch(error){\n    console.error("GETLINK bootstrap failed",error);\n  }\n})();'''
if new not in index:
    assert index.count(old) == 1, "unexpected index bootstrap block"
    index = index.replace(old, new, 1)
index_path.write_text(index, encoding="utf-8")

print("Applied single-owner Tạp hóa order runtime bootstrap")
