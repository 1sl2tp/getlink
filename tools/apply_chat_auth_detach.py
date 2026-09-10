from pathlib import Path
import subprocess

ROOT=Path(__file__).resolve().parents[1]

order_ui=ROOT/'order-management.js'
text=order_ui.read_text('utf-8')

repls=[
('  "use strict";\n\n  const AUTH_KEY="getlink:chat-order-auth";',
 '  "use strict";\n\n  const CHAT_AUTH_DETACHED=true;\n  const AUTH_KEY="getlink:chat-order-auth";\n  sessionStorage.removeItem("getlink:chat-order-auth");\n  sessionStorage.removeItem("getlink:order-selected-customer");'),
('  function readAuth(){\n    try{',
 '  function readAuth(){\n    if(CHAT_AUTH_DETACHED){sessionStorage.removeItem(AUTH_KEY);return null;}\n    try{'),
('  async function acceptChatBridge(message){\n    const seq=++bridgeSeq;',
 '  async function acceptChatBridge(message){\n    if(CHAT_AUTH_DETACHED){clearAuth();return false;}\n    const seq=++bridgeSeq;'),
('  function requestChatAuth(){\n    if(!isEmbeddedInChat())return false;',
 '  function requestChatAuth(){\n    if(CHAT_AUTH_DETACHED)return false;\n    if(!isEmbeddedInChat())return false;'),
('  async function requireChatAuth(message="Đang xác thực qua Chat..."){\n    if(readAuth())return true;',
 '  async function requireChatAuth(message="Đang xác thực qua Chat..."){\n    if(CHAT_AUTH_DETACHED){\n      clearAuth();\n      setMainStatus("GETLINK đã tách quyền xác thực khỏi Chat.");\n      setManagerGate("GETLINK đã tách quyền xác thực khỏi Chat.");\n      return false;\n    }\n    if(readAuth())return true;')
]
for old,new in repls:
    count=text.count(old)
    assert count==1,(old,count)
    text=text.replace(old,new,1)
order_ui.write_text(text,'utf-8')

orders=ROOT/'supabase/functions/getlink-orders/index.ts'
text=orders.read_text('utf-8')
old='const enc=new TextEncoder();\nconst ORDER_STATUSES='
new='const enc=new TextEncoder();\nconst CHAT_AUTH_DETACHED=true;\nconst ORDER_STATUSES='
assert text.count(old)==1,text.count(old)
text=text.replace(old,new,1)
old='  if(!publicKeyAuthorized(req))return json(req,{error:"unauthorized"},401);\n  try{\n    const path=routePath(req);\n    const actor=await chatIdentity(req);'
new='  if(!publicKeyAuthorized(req))return json(req,{error:"unauthorized"},401);\n  if(CHAT_AUTH_DETACHED)return json(req,{error:"chat_auth_detached"},410);\n  try{\n    const path=routePath(req);\n    const actor=await chatIdentity(req);'
assert text.count(old)==1,text.count(old)
text=text.replace(old,new,1)
orders.write_text(text,'utf-8')

subprocess.run(['python',str(ROOT/'tools/stamp_static_build.py')],cwd=ROOT,check=True)
print('Chat auth detachment applied and static build stamped')
