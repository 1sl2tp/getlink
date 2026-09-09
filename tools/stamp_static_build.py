from pathlib import Path
import argparse, hashlib, json, re, sys

ROOT=Path(__file__).resolve().parents[1]
INDEX=ROOT/'index.html'
VERSION=ROOT/'version.json'
PLACEHOLDER='__GETLINK_BUILD_ID__'
ASSETS=('app.js','style.css','config.js')

def normalized_index(text):
    meta_pattern=r'(<meta name="app-build-id" content=")[^"]*(">)'
    normalized,meta_count=re.subn(
        meta_pattern,
        lambda m:m.group(1)+PLACEHOLDER+m.group(2),
        text,
        count=1
    )
    style_pattern=r'(<link rel="stylesheet" href="./style\.css\?v=)[^"]+(">)'
    normalized,style_count=re.subn(
        style_pattern,
        lambda m:m.group(1)+PLACEHOLDER+m.group(2),
        normalized,
        count=1
    )
    if meta_count!=1:
        raise SystemExit('missing app-build-id meta')
    if style_count!=1:
        raise SystemExit('missing blocking style.css build link')
    return normalized

def calculate():
    current=INDEX.read_text('utf-8')
    normalized=normalized_index(current)
    h=hashlib.sha256()
    h.update(normalized.encode('utf-8'))
    for name in ASSETS:
        h.update(b'\0asset\0')
        h.update(name.encode('utf-8'))
        h.update(b'\0')
        h.update((ROOT/name).read_bytes())
    build_id=h.hexdigest()
    stamped=normalized.replace(PLACEHOLDER,build_id)
    payload={
        'version':'GETLINK',
        'build_id':build_id,
        'update_policy':'auto-when-safe',
        'published_from':'github-main',
        'assets':['index.html','style.css','config.js','app.js'],
    }
    version_text=json.dumps(payload,ensure_ascii=False,indent=2)+'\n'
    return build_id,stamped,version_text

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--check',action='store_true')
    args=parser.parse_args()
    build_id,stamped,version_text=calculate()
    if args.check:
        ok=True
        if INDEX.read_text('utf-8')!=stamped:
            print('index.html build stamp is stale',file=sys.stderr)
            ok=False
        if not VERSION.exists() or VERSION.read_text('utf-8')!=version_text:
            print('version.json build metadata is stale',file=sys.stderr)
            ok=False
        if not ok:
            raise SystemExit(1)
        print(f'GETLINK static build PASS build_id={build_id}')
        return
    INDEX.write_text(stamped,'utf-8')
    VERSION.write_text(version_text,'utf-8')
    print(f'GETLINK static build stamped build_id={build_id}')

if __name__=='__main__':
    main()
