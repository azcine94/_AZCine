"""Read-only verification of an already installed candidate; writes a NEW receipt only.
Optional packages for other OS/CPU must be absent; own-platform dependencies exact.
"""
from pathlib import Path
import datetime
import hashlib
import json
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'artifacts/validation/s03-runtime-source-2026-10-02T19-49-34.287-00-00'
INSTALL = Path(sys.argv[1]).resolve()
OUT = ROOT / 'artifacts/validation' / ('s03-runtime-integrity-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H-%M-%S-%fZ'))
OUT.mkdir()
package_root = INSTALL / 'runtime/pi'
package = package_root / 'node_modules/@earendil-works/pi-coding-agent'
report = {'out': str(INSTALL), 'receiptDir': str(OUT), 'checks': [], 'mode': 'exact upstream main files and dependency lock; no install/execution/modification'}
def check(name, ok, detail=None):
    report['checks'].append({'name': name, 'ok': bool(ok), 'detail': detail})
try:
    installed_report = json.loads((INSTALL / 'report.json').read_text(encoding='utf-8'))
    check('Own Node ran exact version', installed_report['nodeVersion']['stdout'] == 'v24.21.0' and installed_report['nodeVersion']['code'] == 0)
    check('Independent npm ci completed', installed_report['installExitCode'] == 0 and 'ci' in installed_report['command'])
    original = json.loads((SOURCE / 'upstream-readonly/package/npm-shrinkwrap.json').read_text(encoding='utf-8'))
    locked = json.loads((package_root / 'package-lock.json').read_text(encoding='utf-8'))
    for relative, expected in original['packages'].items():
        if not relative:
            continue
        check('Lock entry unchanged: ' + relative, locked['packages'].get(relative) == expected)
        excluded = bool(expected.get('optional')) and (('os' in expected and 'win32' not in expected['os']) or ('cpu' in expected and 'x64' not in expected['cpu']))
        target = package_root / relative / 'package.json'
        actual = json.loads(target.read_text(encoding='utf-8')) if target.is_file() else None
        check('Exact installed dependency/platform: ' + relative, (excluded and actual is None) or (actual is not None and actual['version'] == expected['version']), {'platformExcluded': excluded, 'expected': expected['version'], 'actual': actual['version'] if actual else None})
    hashes = {}
    with tarfile.open(SOURCE / 'pi-coding-agent-0.99.1.tgz', 'r:gz') as archive:
        for member in archive.getmembers():
            if not member.isfile():
                continue
            relative = Path(*member.name.split('/')[1:])
            target = package / relative
            expected = archive.extractfile(member).read()
            check('Upstream file unchanged: ' + str(relative), target.is_file() and target.read_bytes() == expected)
            hashes[str(relative)] = hashlib.sha256(expected).hexdigest()
    (OUT / 'upstream-sha256.json').write_text(json.dumps(hashes, indent=2), encoding='utf-8')
    report['nodePath'] = str(INSTALL / 'runtime/node-v24.21.0-win-x64/node.exe')
    report['piPath'] = str(package / 'dist/bundle/cli.js')
    report['success'] = all(c['ok'] for c in report['checks'])
except Exception as error:
    report['success'] = False
    report['error'] = str(error)
(OUT / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps({'out': str(OUT), 'success': report['success'], 'checks': len(report['checks']), 'failures': [c for c in report['checks'] if not c['ok']], 'error': report.get('error')}))
if not report['success']:
    sys.exit(1)
