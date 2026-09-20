#!/usr/bin/env python3
import re, sys, urllib.request

URLS=[
 "https://www.vinamilk.com.vn/_next/static/chunks/3893-516714ed7d90043f.js",
 "https://www.vinamilk.com.vn/_next/static/chunks/5202-8f7a4caf9d5f512c.js",
 "https://www.vinamilk.com.vn/_next/static/chunks/app/%5Blocale%5D/layout-26123d2f22ead3d6.js",
 "https://www.vinamilk.com.vn/_next/static/chunks/app/%5Blocale%5D/template-5b5c1bbf8dfbc932.js",
]
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36"

def get(url):
    req=urllib.request.Request(url,headers={"User-Agent":UA,"Accept":"*/*","Referer":"https://www.vinamilk.com.vn/"})
    with urllib.request.urlopen(req,timeout=30) as r:
        body=r.read().decode("utf-8","replace")
        print("VNM_STATIC",r.status,len(body),url)
        return body

def around(s,pos,r=6000):
    return s[max(0,pos-r):min(len(s),pos+r)].replace("\n"," ")

bodies=[]
for url in URLS:
    try:bodies.append((url,get(url)))
    except Exception as e:print("VNM_STATIC_WARN",url,type(e).__name__,str(e)[:300])

if not bodies:
    raise SystemExit(1)

for url,body in bodies:
    for marker in ["generateApiSignature","VNM_SIGNATURE_SALT","VNM_CLIENT_ID","x-graphql-hash"]:
        start=0
        for n in range(12):
            p=body.find(marker,start)
            if p<0:break
            print("VNM_STATIC_HIT",url,marker,n+1,around(body,p,7000))
            start=p+len(marker)

    # webpack modules containing the call; expose require ids and local aliases.
    for m in re.finditer(r"generateApiSignature",body):
        left=body[max(0,m.start()-12000):m.start()]
        mods=re.findall(r"([A-Za-z_$][\w$]*)=r\((\d+)\)",left)
        print("VNM_STATIC_IMPORTS",url,mods[-80:])

print("VNM_STATIC_DONE")
