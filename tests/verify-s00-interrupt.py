"""Windows-only real Ctrl+C test in an owned, dedicated console. No shared-console broadcast."""
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone

root = Path(__file__).resolve().parents[1]
output = root / 'artifacts' / 'validation' / ('s00-interrupt-' + datetime.now(timezone.utc).strftime('%Y-%m-%dT%H-%M-%SZ'))
output.mkdir(parents=True)


def powershell(script):
    return subprocess.run(['pwsh.exe', '-NoProfile', '-Command', script], capture_output=True, text=True, encoding='utf-8', check=True).stdout


# Abort rather than attach to another application's occupied port.
ports = powershell("@(Get-NetTCPConnection -State Listen -LocalPort 1420,9223 -ErrorAction SilentlyContinue).Count; exit 0").strip()
if ports != '0':
    raise RuntimeError('1420/9223 already occupied; not starting or stopping anything.')

env = dict(os.environ)
env['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS'] = '--remote-debugging-port=9223 --remote-debugging-address=127.0.0.1'
env['WEBVIEW2_USER_DATA_FOLDER'] = str(root / '.tooling' / 'webview-s00-interrupt')
log = (output / 'dev.log').open('w', encoding='utf-8')
process = subprocess.Popen(['cmd.exe', '/d', '/c', 'npm run dev'], cwd=root, env=env, creationflags=subprocess.CREATE_NEW_CONSOLE, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT)
report = {'operation': 'dedicated owned Windows console Ctrl+C', 'rootPid': process.pid, 'ready': False}
try:
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f'Dev process exited before readiness: {process.returncode}')
        try:
            with opener.open('http://127.0.0.1:9223/json/list', timeout=1) as response:
                targets = json.load(response)
            if any(t.get('url', '').startswith('http://127.0.0.1:1420') for t in targets):
                report['ready'] = True
                break
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            pass
        # Condition polling only for this finite integration readiness, not agent completion.
        time.sleep(0.1)
    if not report['ready']:
        raise TimeoutError('Owned WebView2 not ready within 60 seconds.')
    tree_json = powershell(f"$all=Get-CimInstance Win32_Process|Select-Object ProcessId,ParentProcessId,Name,CreationDate; $owned=[System.Collections.Generic.HashSet[uint32]]::new(); [void]$owned.Add({process.pid}); do{{$changed=$false; foreach($p in $all){{if($owned.Contains($p.ParentProcessId) -and $owned.Add($p.ProcessId)){{$changed=$true}}}}}}while($changed); @($all|Where-Object {{$owned.Contains($_.ProcessId)}})|ConvertTo-Json -Depth 4")
    report['before'] = json.loads(tree_json)
    (output / 'owned-tree.json').write_text(tree_json, encoding='utf-8')
    signal = subprocess.run(['pwsh.exe', '-NoProfile', '-File', str(root / 'tests/support/interrupt-owned-console.ps1'), '-ConsoleOwnerPid', str(process.pid)], capture_output=True, text=True, encoding='utf-8')
    report['signalExit'] = signal.returncode
    report['signalError'] = signal.stderr
    if signal.returncode:
        raise RuntimeError('Ctrl+C signal delivery failed.')
    report['devExit'] = process.wait(timeout=30)
    after = powershell(f"$old=Get-Content -Raw '{output / 'owned-tree.json'}'|ConvertFrom-Json; $handles=@($old|ForEach-Object {{Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue}}); if($handles){{$handles|Wait-Process -Timeout 20 -ErrorAction SilentlyContinue}}; $remaining=@(Get-CimInstance Win32_Process|Where-Object {{$now=$_; $old|Where-Object {{$_.ProcessId -eq $now.ProcessId -and ([datetime]$_.CreationDate) -eq $now.CreationDate}}}}|Select-Object ProcessId,Name); $ports=@(Get-NetTCPConnection -State Listen -LocalPort 1420,9223 -ErrorAction SilentlyContinue|Select-Object LocalPort,OwningProcess); @{{remaining=$remaining;ports=$ports}}|ConvertTo-Json -Depth 4; exit 0")
    report.update(json.loads(after))
    report['passed'] = not report['remaining'] and not report['ports']
finally:
    # Emergency cleanup is restricted to this still-owned root and is never counted as passing.
    if process.poll() is None:
        subprocess.run(['taskkill.exe', '/PID', str(process.pid), '/T', '/F'], capture_output=True)
        report['emergencyCleanup'] = True
        report['passed'] = False
    log.close()
    (output / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')
print(json.dumps({'output': str(output), 'passed': report.get('passed'), 'devExit': report.get('devExit'), 'remaining': report.get('remaining'), 'ports': report.get('ports')}, ensure_ascii=False))
if not report.get('passed'):
    raise SystemExit(1)
