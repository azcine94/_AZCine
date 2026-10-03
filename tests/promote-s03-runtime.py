"""Copy only the already verified app-owned runtime into fresh application resources.
--resume-incomplete fills a retained partial destination only after exact byte checks.
Revalidate official archive bytes, full upstream lock, symlink absence and every
copied byte. No execution/install, no external Pi source, no overwrite or deletion.
"""
from pathlib import Path
import datetime
import hashlib
import json
import shutil
import tarfile
import zipfile
import sys
ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'artifacts/validation/s03-runtime-source-2026-10-02T19-49-34.287-00-00'
INSTALL=ROOT/'artifacts/validation/s03-runtime-install-2026-10-02T21-56-17-771510Z'
DEST=ROOT/'app/resources/runtime/pi-0.99.1-node-24.21.0'
OUT=ROOT/'artifacts/validation'/('s03-runtime-promotion-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H-%M-%S-%fZ'));OUT.mkdir()
report={'out':str(OUT),'destination':str(DEST),'mode':'app-owned byte-for-byte resource copy, no execution/model call','checks':[]}
def check(name,ok):
 report['checks'].append({'name':name,'ok':bool(ok)})
 if not ok:raise RuntimeError(name)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
try:
 receipt=json.loads((ROOT/'artifacts/validation/s03-runtime-integrity-2026-10-02T21-59-53-112934Z/report.json').read_text(encoding='utf-8'))
 check('exact runtime receipt passed',receipt['success'])
 resume='--resume-incomplete' in sys.argv
 check('destination is fresh or explicitly retained incomplete',not DEST.exists() or (resume and not (DEST/'runtime-manifest.json').exists()))
 original=INSTALL/'runtime'
 for p in original.rglob('*'):
  check('own source has no link: '+p.relative_to(original).as_posix(),not p.is_symlink() and not p.is_junction())
 check('Pi official tarball SHA',sha(SOURCE/'pi-coding-agent-0.99.1.tgz')=='6686592adaea19092c85c94f5d40323dbf3db141e90eb3ede9e9e87302abdd1d')
 check('Node official archive SHA',sha(SOURCE/'node-v24.21.0-win-x64.zip')=='158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541')
 with tarfile.open(SOURCE/'pi-coding-agent-0.99.1.tgz','r:gz') as a:
  package=original/'pi/node_modules/@earendil-works/pi-coding-agent'
  for m in a.getmembers():
   if m.isfile():check('original Pi unchanged: '+m.name,(package/Path(*m.name.split('/')[1:])).read_bytes()==a.extractfile(m).read())
 with zipfile.ZipFile(SOURCE/'node-v24.21.0-win-x64.zip') as a:
  for m in a.infolist():
   if not m.is_dir():check('original Node unchanged: '+m.filename,(original/Path(*m.filename.split('/'))).read_bytes()==a.read(m))
 native=json.loads((SOURCE/'upstream-readonly/package/npm-shrinkwrap.json').read_text(encoding='utf-8'))
 lock=json.loads((original/'pi/package-lock.json').read_text(encoding='utf-8'))
 for name,expected in native['packages'].items():
  if not name:continue
  check('exact dependency lock: '+name,lock['packages'][name]==expected)
  file=original/'pi'/name/'package.json';excluded=bool(expected.get('optional')) and (('os' in expected and 'win32' not in expected['os']) or ('cpu' in expected and 'x64' not in expected['cpu']))
  check('actual dependency: '+name,(excluded and not file.exists()) or (file.is_file() and json.loads(file.read_text(encoding='utf-8'))['version']==expected['version']))
 before={p.relative_to(original).as_posix():sha(p) for p in original.rglob('*') if p.is_file()}
 DEST.parent.mkdir(parents=True,exist_ok=True)
 if not DEST.exists():
  shutil.copytree(original,DEST)
 else:
  for p in DEST.rglob('*'):
   check('partial copy has no links: '+p.relative_to(DEST).as_posix(),not p.is_symlink() and not p.is_junction())
   if p.is_file():check('partial existing byte match: '+p.relative_to(DEST).as_posix(),before.get(p.relative_to(DEST).as_posix())==sha(p))
  for relative,expected in before.items():
   target=DEST/relative
   if not target.exists():
    target.parent.mkdir(parents=True,exist_ok=True)
    with (original/relative).open('rb') as source,target.open('xb') as destination:shutil.copyfileobj(source,destination)
   check('completed copied byte match: '+relative,sha(target)==expected)
 after={p.relative_to(DEST).as_posix():sha(p) for p in DEST.rglob('*') if p.is_file()}
 check('all copied bytes exactly match source',before==after)
 manifest={'version':1,'piVersion':'0.99.1','nodeVersion':'24.21.0','node':'node-v24.21.0-win-x64/node.exe','pi':'pi/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js','packageLock':'pi/package-lock.json','source':{'pi':'https://registry.npmjs.org/@earendil-works/pi-coding-agent/-/pi-coding-agent-0.99.1.tgz','piSha256':'6686592adaea19092c85c94f5d40323dbf3db141e90eb3ede9e9e87302abdd1d','node':'https://nodejs.org/dist/v24.21.0/node-v24.21.0-win-x64.zip','nodeSha256':'158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541'}}
 manifest['entrySha256']={key:after[manifest[key]] for key in ['node','pi','packageLock']}
 (DEST/'runtime-manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
 (OUT/'copied-files-sha256.json').write_text(json.dumps(after,indent=2),encoding='utf-8')
 report.update(passed=True,files=len(after),manifest=manifest)
except Exception as e:report.update(passed=False,error=str(e))
(OUT/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps({k:report.get(k) for k in ['out','destination','passed','files','error']}))
if not report['passed']:sys.exit(1)
