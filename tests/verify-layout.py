"""Check English paths, active local references and byte-preserved migration history.
Reads project files only; creates one new JSON under artifacts/validation per invocation.
"""
from pathlib import Path
from urllib.parse import urlsplit, unquote
from html.parser import HTMLParser
from datetime import datetime, timezone
import hashlib, json, re, zipfile
ROOT=Path(__file__).resolve().parents[1]
checks=[]
def check(name,ok,detail=None):
 checks.append({'name':name,'passed':bool(ok),'detail':detail})
 if not ok:print('FAIL',name,detail)
sha=lambda data:hashlib.sha256(data).hexdigest()
manifest=json.loads((ROOT/'research/migration/path-map.json').read_text(encoding='utf8'))
# Document relocations are separate from the immutable original migration map.
documents=json.loads((ROOT/'archive/documents-2026-10-03t03-40-44-995737z/manifest.json').read_text(encoding='utf8'))
relocations={e['original']:e for e in documents['entries'] if e['action']=='move'}
paths=[p for p in ROOT.rglob('*')]
check('All current file and directory paths are ASCII',all(p.relative_to(ROOT).as_posix().isascii()for p in paths),[p.relative_to(ROOT).as_posix()for p in paths if not p.relative_to(ROOT).as_posix().isascii()])
check('No old parallel directories',not any((ROOT/p).exists()for p in ['设计','调研','.playwright-mcp']))
check('Root has explicit entry and guide',(ROOT/'index.html').is_file()and(ROOT/'README.md').is_file())
check('Design has no screenshots or validation output',not any(p.suffix.lower()in ['.png','.pdf','.log','.json']for p in (ROOT/'design').rglob('*')if p.is_file()))
archive=ROOT/manifest['snapshot']
check('Snapshot hash unchanged',sha(archive.read_bytes())==manifest['snapshot_sha256'])
with zipfile.ZipFile(archive)as z:
 check('Snapshot member paths are ASCII',all(n.isascii()for n in z.namelist()))
 for e in manifest['entries']:
  check('Original retained '+e['old'],sha(z.read(e['new']))==e['sha256'])
  relocation=relocations.get(e['new'])
  mapped=ROOT/(relocation['archived'] if relocation else e['new'])
  check('Mapped file exists '+e['new'],mapped.is_file())
  if e['new'].startswith('archive/'):
   check('Frozen evidence unchanged '+e['new'],sha(mapped.read_bytes())==e['sha256'])
  elif relocation:
   check('Archived document unchanged '+e['new'],sha(mapped.read_bytes())==relocation['sha256'])
class Links(HTMLParser):
 def __init__(self):super().__init__();self.urls=[]
 def handle_starttag(self,tag,attrs):
  a=dict(attrs)
  for key in ['href','src']:
   if key in a:self.urls.append(a[key])
  if tag=='meta' and a.get('http-equiv','').lower()=='refresh':
   m=re.search(r'url=(.+)',a.get('content',''),re.I)
   if m:self.urls.append(m[1])
def local_exists(file,url):
 if '${' in url or url.startswith(('data:','http:','https:','mailto:','#','javascript:')):return
 target=unquote(urlsplit(url).path)
 if not target:return
 resolved=(file.parent/target).resolve()
 check('Local link '+file.relative_to(ROOT).as_posix()+' -> '+url,resolved.is_relative_to(ROOT)and resolved.exists())
for p in [ROOT/'index.html',*(ROOT/'design').rglob('*.html'),*(ROOT/'research').rglob('*.html')]:
 parser=Links();parser.feed(p.read_text(encoding='utf8'))
 for url in parser.urls:local_exists(p,url)
for p in (ROOT/'design').glob('*.css'):
 for url in re.findall(r'url\([\'\"]?([^\)\'\"]+)',p.read_text(encoding='utf8')):local_exists(p,url)
# Dynamic direction links and static brand resource in app.js.
s=(ROOT/'design/app.js').read_text(encoding='utf8')
for url in re.findall(r"['\"]([^'\"]+(?:\.html|\.png))['\"]",s):local_exists(ROOT/'design/app.js',url)
core_documents=['AGENTS.md','README.md','docs/requirements.md','docs/design-spec.md','docs/development-plan.md','docs/project-architecture.md','docs/current-work.md']
for p in [ROOT/name for name in core_documents]:
 for url in re.findall(r'\]\(([^)]+)\)',p.read_text(encoding='utf8')):local_exists(p,url)
check('Active app contains no old directory references',not any(re.search(r'设计/v2|\.\./\.\./assets/brand|方向[ABC]\.html',p.read_text(encoding='utf8'))for p in (ROOT/'design').glob('*')if p.suffix in ['.js','.html']))
report={'scope':'layout, local references, immutable migration evidence','summary':{'passed':sum(c['passed']for c in checks),'failed':sum(not c['passed']for c in checks)},'checks':checks}
out=ROOT/'artifacts/validation'/('layout-'+datetime.now(timezone.utc).isoformat().replace(':','-').replace('.','-'));out.mkdir(parents=True)
(out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps({'report':str(out/'report.json'),'summary':report['summary']}))
raise SystemExit(bool(report['summary']['failed']))
