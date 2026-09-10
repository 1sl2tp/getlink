from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]

order = ROOT / "order-management.js"
text = order.read_text("utf-8")

replacements = [
    (
        '  "use strict";\n\n  const AUTH_KEY="getlink:chat-order-auth";',
        '  "use strict";\n\n  const ACCESS_STATES=Object.freeze(["guest","user","admin"]);\n  const AUTH_KEY="getlink:chat-order-auth";'
    ),
    (
        '  function storeAuth(value){\n    sessionStorage.setItem(AUTH_KEY,JSON.stringify(value));\n    syncCustomerControls();\n  }',
        '  function storeAuth(value){\n    sessionStorage.setItem(AUTH_KEY,JSON.stringify(value));\n    syncCustomerControls();\n    emitAccessChange();\n  }'
    ),
    (
        '    clearSelectedCustomer();\n    syncCustomerControls();\n  }\n  function currentAccount(){return readAuth()?.account||null}\n  function currentRole(){return currentAccount()?.role==="admin"?"admin":"user"}',
        '    clearSelectedCustomer();\n    syncCustomerControls();\n    emitAccessChange();\n  }\n  function currentAccount(){return readAuth()?.account||null}\n  function currentAccessState(){\n    const auth=readAuth();\n    if(!auth)return "guest";\n    return auth.account?.role==="admin"?"admin":"user";\n  }\n  function accessSnapshot(){\n    const auth=readAuth();\n    return {\n      state:currentAccessState(),\n      account:auth?.account?{...auth.account}:null,\n      source:auth?.source==="chat"?"chat":null\n    };\n  }\n  function emitAccessChange(){\n    document.dispatchEvent(new CustomEvent("getlink-access-change",{detail:accessSnapshot()}));\n  }\n  function currentRole(){return currentAccessState()}'
    ),
    (
        '  injectUi();\n  requestChatAuth();',
        '  window.GETLINK_ACCESS_CONTEXT={states:ACCESS_STATES,snapshot:accessSnapshot};\n  injectUi();\n  emitAccessChange();\n  requestChatAuth();'
    )
]

for old, new in replacements:
    count = text.count(old)
    assert count == 1, (old[:100], count)
    text = text.replace(old, new, 1)
order.write_text(text, "utf-8")

app = ROOT / "app.js"
text = app.read_text("utf-8")
old = 'let appRole="user";\n'
new = (
    'let appRole="user";\n'
    '// appRole is UI presentation only; it is not account identity or a second login.\n'
    '// Sales identity is GETLINK_ACCESS_CONTEXT with exactly guest/user/admin, normally sourced from Chat.\n'
)
assert text.count(old) == 1, text.count(old)
text = text.replace(old, new, 1)
app.write_text(text, "utf-8")

subprocess.run(["python", str(ROOT / "tools/stamp_static_build.py")], cwd=ROOT, check=True)
print("GETLINK access model clarified and static build stamped")
