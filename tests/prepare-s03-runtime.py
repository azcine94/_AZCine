"""Install a fresh, retained upstream Pi candidate using its own Node and npm.
No global installs, host npm config/auth reads, package scripts, Pi startup or model call.
Input archives must already exist; each invocation creates a new validation run.
"""
from pathlib import Path, PurePosixPath
import datetime
import hashlib
import json
import os
import subprocess
import sys
import tarfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'artifacts/validation/s03-runtime-source-2026-10-02T19-49-34.287-00-00'
NODE_SHA = '158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541'
PI_SHA = '6686592adaea19092c85c94f5d40323dbf3db141e90eb3ede9e9e87302abdd1d'
OUT = ROOT / 'artifacts/validation' / ('s03-runtime-install-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H-%M-%S-%fZ'))
OUT.mkdir()
report = {'mode': 'independent upstream package install only; no Pi/model execution', 'out': str(OUT), 'checks': []}

def require(name, condition):
    report['checks'].append({'name': name, 'ok': bool(condition)})
    if not condition:
        raise RuntimeError(name)

def member_path(name):
    path = PurePosixPath(name)
    require('archive member is relative ASCII without traversal: ' + name, path.is_relative_to('.') and not path.is_absolute() and '..' not in path.parts and '\\' not in name and ':' not in name and name.isascii())
    return Path(*path.parts)

try:
    if sys.platform != 'win32':
        raise RuntimeError('This candidate is Windows x64 only')
    node_zip = SOURCE / 'node-v24.21.0-win-x64.zip'
    pi_tgz = SOURCE / 'pi-coding-agent-0.99.1.tgz'
    require('Node official SHA-256', hashlib.sha256(node_zip.read_bytes()).hexdigest() == NODE_SHA)
    require('Pi official tarball SHA-256', hashlib.sha256(pi_tgz.read_bytes()).hexdigest() == PI_SHA)
    runtime = OUT / 'runtime'
    runtime.mkdir()
    with zipfile.ZipFile(node_zip) as archive:
        for member in archive.infolist():
            relative = member_path(member.filename)
            if ((member.external_attr >> 16) & 0o170000) == 0o120000:
                raise RuntimeError('Symlink in Node archive')
            target = runtime / relative
            if member.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with target.open('xb') as file:
                    file.write(archive.read(member))
    node_dir = runtime / 'node-v24.21.0-win-x64'
    node = node_dir / 'node.exe'
    npm = node_dir / 'node_modules/npm/bin/npm-cli.js'
    package_root = runtime / 'pi'
    package_root.mkdir()
    wrapper = {'name': 'azcine-upstream-pi-runtime', 'private': True, 'version': '0.0.0', 'dependencies': {'@earendil-works/pi-coding-agent': '0.99.1'}}
    (package_root / 'package.json').write_text(json.dumps(wrapper, indent=2), encoding='utf-8')
    # npm install <tgz> can float transitive dependencies despite the nested
    # shrinkwrap. Compose an external, exact wrapper lock without changing any
    # upstream file, then use npm ci in a brand-new directory only.
    upstream_lock = json.loads((SOURCE / 'upstream-readonly/package/npm-shrinkwrap.json').read_text(encoding='utf-8'))
    metadata = json.loads((SOURCE / 'pi-metadata.json').read_text(encoding='utf-8'))
    locked_packages = {key: value for key, value in upstream_lock['packages'].items() if key}
    locked_packages[''] = {'name': wrapper['name'], 'version': wrapper['version'], 'dependencies': wrapper['dependencies']}
    locked_packages['node_modules/@earendil-works/pi-coding-agent'] = {**upstream_lock['packages'][''], 'resolved': metadata['dist']['tarball'], 'integrity': metadata['dist']['integrity']}
    wrapper_lock = {'name': wrapper['name'], 'version': wrapper['version'], 'lockfileVersion': 3, 'requires': True, 'packages': locked_packages}
    locked_text = json.dumps(wrapper_lock, indent=2)
    (package_root / 'package-lock.json').write_text(locked_text, encoding='utf-8')
    for directory in ['home', 'appdata', 'localappdata', 'temp', 'npm-cache', 'npm-global']:
        (OUT / directory).mkdir()
    for file in ['npm-user.rc', 'npm-global.rc']:
        (OUT / file).write_text('', encoding='utf-8')
    # Read only known non-secret OS location values. Never enumerate parent env.
    system_root = os.environ.get('SystemRoot', r'C:\Windows')
    env = {
        'SystemRoot': system_root, 'WINDIR': system_root,
        'ComSpec': str(Path(system_root) / 'System32/cmd.exe'),
        'PATH': os.pathsep.join([str(node_dir), str(Path(system_root) / 'System32'), system_root]),
        'HOME': str(OUT / 'home'), 'USERPROFILE': str(OUT / 'home'),
        'APPDATA': str(OUT / 'appdata'), 'LOCALAPPDATA': str(OUT / 'localappdata'),
        'TEMP': str(OUT / 'temp'), 'TMP': str(OUT / 'temp'),
        'NPM_CONFIG_USERCONFIG': str(OUT / 'npm-user.rc'), 'NPM_CONFIG_GLOBALCONFIG': str(OUT / 'npm-global.rc'),
        'NPM_CONFIG_CACHE': str(OUT / 'npm-cache'), 'NPM_CONFIG_PREFIX': str(OUT / 'npm-global'),
        'NO_UPDATE_NOTIFIER': '1',
    }
    report['environmentKeys'] = sorted(env)
    version = subprocess.run([str(node), '--version'], env=env, cwd=OUT, capture_output=True, text=True, timeout=30)
    report['nodeVersion'] = {'code': version.returncode, 'stdout': version.stdout.strip(), 'stderr': version.stderr}
    require('Own Node version is v24.21.0', version.returncode == 0 and version.stdout.strip() == 'v24.21.0')
    require('Fresh install destination has no files for ci to delete', not (package_root / 'node_modules').exists())
    command = [str(node), str(npm), 'ci', '--ignore-scripts', '--no-audit', '--no-fund', '--no-progress', '--omit=dev', '--registry=https://registry.npmjs.org/', '--proxy=http://127.0.0.1:7890', '--https-proxy=http://127.0.0.1:7890']
    report['command'] = command
    print(json.dumps({'run': str(OUT), 'install': 'upstream Pi 0.99.1 with owned Node 24.21.0; no lifecycle scripts'}, ensure_ascii=False), flush=True)
    with (OUT / 'npm-install.log').open('xb') as log:
        result = subprocess.run(command, cwd=package_root, env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=log, timeout=600)
    report['installExitCode'] = result.returncode
    require('Independent npm install exit 0', result.returncode == 0)
    installed = package_root / 'node_modules/@earendil-works/pi-coding-agent'
    upstream_files = {}
    with tarfile.open(pi_tgz, 'r:gz') as archive:
        for member in archive.getmembers():
            if not member.isfile():
                continue
            relative = member_path(member.name)
            require('Pi member under package/', relative.parts[0] == 'package')
            target = installed.joinpath(*relative.parts[1:])
            data = archive.extractfile(member).read()
            require('Installed upstream file unchanged: ' + member.name, target.is_file() and target.read_bytes() == data)
            upstream_files[str(relative)] = hashlib.sha256(data).hexdigest()
    (OUT / 'upstream-files-sha256.json').write_text(json.dumps(upstream_files, indent=2), encoding='utf-8')
    lock = json.loads((package_root / 'package-lock.json').read_text(encoding='utf-8'))
    require('External complete dependency lock unchanged by ci', lock == wrapper_lock)
    dependency_checks = []
    for relative, entry in upstream_lock['packages'].items():
        if not relative:
            continue
        target = package_root / relative / 'package.json'
        installed_meta = json.loads(target.read_text(encoding='utf-8')) if target.is_file() else None
        platform_excluded = bool(entry.get('optional')) and (('os' in entry and 'win32' not in entry['os']) or ('cpu' in entry and 'x64' not in entry['cpu']))
        matches = (platform_excluded and installed_meta is None) or (installed_meta is not None and installed_meta.get('version') == entry['version'])
        dependency_checks.append({'path': relative, 'expected': entry['version'], 'actual': installed_meta.get('version') if installed_meta else None, 'platformExcluded': platform_excluded, 'ok': matches})
        require('Dependency installed at original exact version: ' + relative, matches)
    (OUT / 'dependency-lock-comparison.json').write_text(json.dumps({'checks': dependency_checks, 'success': all(c['ok'] for c in dependency_checks)}, indent=2), encoding='utf-8')
    report['installedPackageCount'] = len(lock['packages'])
    report['nodePath'] = str(node)
    report['piPath'] = str(installed / 'dist/bundle/cli.js')
    report['success'] = True
except Exception as error:
    report['success'] = False
    report['error'] = str(error)
    print(str(error), file=sys.stderr)
finally:
    (OUT / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')
    print(json.dumps({'report': str(OUT / 'report.json'), 'success': report.get('success', False)}, ensure_ascii=False), flush=True)
if not report.get('success'):
    sys.exit(1)
