"""Load Rust-generated synthetic model settings with actual unmodified upstream RPC.
No prompt/model/network request. All files and logs retained. Never accepts a real
user root: the input must be a passed candidate report and its explicit fixture.
"""
from pathlib import Path
import datetime
import json
import os
import queue
import shutil
import subprocess
import sys
import threading
import time

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts/validation' / ('s03-native-config-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H-%M-%S-%fZ'))
OUT.mkdir()
report = {'mode': 'actual upstream RPC loads Rust-generated synthetic native config; no prompt, model or paid call', 'out': str(OUT), 'checks': []}
process = None
sent = stdout_file = stderr_file = None
reader = None

def check(name, ok, detail=None):
    report['checks'].append({'name': name, 'ok': bool(ok), 'detail': detail})
    if not ok:
        raise AssertionError(name)

def environment(data, node, package):
    for relative in ['pi/home', 'pi/appdata', 'pi/localappdata', 'pi/temp', 'pi/sessions', 'pi/workspaces/default']:
        (data / relative).mkdir(parents=True, exist_ok=True)
    system = Path(os.environ.get('SystemRoot', r'C:\Windows'))
    return {'SystemRoot': str(system), 'WINDIR': str(system), 'ComSpec': str(system/'System32/cmd.exe'),
            'PATH': os.pathsep.join([str(node.parent),str(system/'System32'),str(system)]),
            'HOME': str(data/'pi/home'), 'USERPROFILE': str(data/'pi/home'),
            'APPDATA': str(data/'pi/appdata'), 'LOCALAPPDATA': str(data/'pi/localappdata'),
            'TEMP': str(data/'pi/temp'), 'TMP': str(data/'pi/temp'),
            'PI_CODING_AGENT_DIR': str(data/'pi/agent'), 'PI_CODING_AGENT_SESSION_DIR': str(data/'pi/sessions'),
            'PI_PACKAGE_DIR': str(package), 'PI_OFFLINE': '1', 'PI_SKIP_VERSION_CHECK': '1', 'PI_TELEMETRY': '0'}

try:
    candidate_report = Path(sys.argv[1]).resolve()
    check('Candidate report belongs to explicit validation runs', candidate_report.is_relative_to(ROOT/'artifacts/validation') and candidate_report.parent.name.startswith('s03-config-store-checks-'))
    candidate = json.loads(candidate_report.read_text(encoding='utf-8'))
    check('Candidate actual tests passed and source was stable', candidate.get('passed') and candidate.get('sourceStable'))
    fixture = candidate_report.parent/'retained-test-data/native-probe-data'
    check('Explicit Rust-generated fixture exists', fixture.is_dir())
    data = OUT/'data'
    shutil.copytree(fixture, data)
    install_path = ROOT/'artifacts/validation/s03-runtime-integrity-2026-10-02T21-59-53-112934Z/report.json'
    install = json.loads(install_path.read_text(encoding='utf-8'))
    check('Previously byte-verified runtime passed', install.get('success'))
    node = Path(install['nodePath']); pi = Path(install['piPath']); package = pi.parents[2]
    env = environment(data, node, package)
    report['environmentKeys'] = sorted(env)
    # Invoke only the public resolver on the explicit synthetic credential; never
    # read/resolve a host auth file and never print any credential value.
    script = OUT/'literal-resolver-check.mjs'
    script.write_text('import { readFileSync } from "node:fs";\nimport { pathToFileURL } from "node:url";\nconst { resolveConfigValue } = await import(pathToFileURL(process.argv[2]).href);\nconst config = JSON.parse(readFileSync(process.argv[3],"utf8"));\nconst passed = resolveConfigValue(config["fixture-service"].key) === "fixture-literal-$NAME-${OTHER}-$$-end";\nconsole.log(JSON.stringify({passed}));if(!passed)process.exitCode=1;\n', encoding='utf-8')
    resolver = subprocess.run([str(node),'--no-global-search-paths',str(script),str(package/'dist/core/resolve-config-value.js'),str(data/'pi/agent/auth.json')],cwd=data/'pi/workspaces/default',env=env,capture_output=True,timeout=30)
    (OUT/'resolver-stdout.log').write_bytes(resolver.stdout); (OUT/'resolver-stderr.log').write_bytes(resolver.stderr)
    check('Native literal resolver preserves embedded dollars without reading environment variables',resolver.returncode==0 and json.loads(resolver.stdout).get('passed'))
    args=[str(node),'--no-global-search-paths',str(pi),'--mode','rpc','--offline','--no-approve','--no-context-files','--session-dir',str(data/'pi/sessions')]
    stdout_file=(OUT/'stdout.jsonl').open('xb'); stderr_file=(OUT/'stderr.log').open('xb');sent=(OUT/'stdin.jsonl').open('xb')
    process=subprocess.Popen(args,cwd=data/'pi/workspaces/default',env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=stderr_file)
    report['pid']=process.pid
    records=queue.Queue(); responses={}; errors=[]
    def read_records():
        try:
            for line in iter(process.stdout.readline,b''):
                stdout_file.write(line);stdout_file.flush();records.put(json.loads(line.decode('utf-8')))
        except Exception as error:
            errors.append(type(error).__name__)
        finally:
            records.put({'type':'_eof'})
    reader=threading.Thread(target=read_records,daemon=True);reader.start()
    number=0
    def request(command, **fields):
        global number
        number+=1;id_=f'config-{number}'
        raw=(json.dumps({'id':id_,'type':command,**fields},ensure_ascii=False)+'\n').encode('utf-8')
        sent.write(raw);sent.flush();process.stdin.write(raw);process.stdin.flush()
        deadline=time.monotonic()+35
        while True:
            value=records.get(timeout=max(0.001,deadline-time.monotonic()))
            if value.get('type')=='_eof':raise RuntimeError('RPC ended before response')
            if value.get('type')=='response':
                if value.get('id')!=id_:raise RuntimeError('Unexpected response ID')
                check(f'Actual {command} correlated success',value.get('command')==command and value.get('success') is True)
                return value.get('data')
    state=request('get_state');models=request('get_available_models')['models']
    selected=[m for m in models if m.get('provider')=='fixture-service' and m.get('id')=='fixture-model']
    check('Native model list loads generated provider and model exactly once',len(selected)==1)
    model=selected[0]
    check('Per-model API endpoint and capabilities load through original schema',model.get('baseUrl')=='https://example.invalid/v1' and model.get('api')=='openai-responses' and model.get('input')==['text','image'] and model.get('contextWindow')==128000 and model.get('maxTokens')==8192)
    check('Native default selected from generated settings not injected CLI probe',state['model'].get('provider')=='fixture-service' and state['model'].get('id')=='fixture-model')
    selected_again=request('set_model',provider='fixture-service',modelId='fixture-model')
    check('Set model actual response names requested provider and model',selected_again.get('provider')=='fixture-service' and selected_again.get('id')=='fixture-model')
    request('set_session_name',name='Explicit config fixture, no inference')
    check('Name roundtrip actual native state',request('get_state').get('sessionName')=='Explicit config fixture, no inference')
    request('clear_queue');request('abort');request('abort_bash')
    messages=request('get_messages')['messages']
    check('No fabricated assistant or sent user prompt',not any(m.get('role') in ['user','assistant'] for m in messages))
    process.stdin.close();report['exitCode']=process.wait(timeout=20);reader.join(timeout=5)
    check('Normal EOF closes original process and valid LF records',report['exitCode']==0 and not reader.is_alive() and not errors)
    report['passed']=True
except Exception as error:
    report['passed']=False;report['error']=f'{type(error).__name__}: {error}'
finally:
    if process and process.poll() is None:
        if not process.stdin.closed:process.stdin.close()
        try:
            report['shutdownExitCode']=process.wait(timeout=20)
        except subprocess.TimeoutExpired:
            system=Path(os.environ.get('SystemRoot',r'C:\Windows'))
            killed=subprocess.run([str(system/'System32/taskkill.exe'),'/PID',str(process.pid),'/T','/F'],capture_output=True,timeout=20)
            report['forcedOwnedTreeStop']=killed.returncode;report['passed']=False;process.wait(timeout=10)
    if reader:reader.join(timeout=5)
    if process:
        if not process.stdin.closed:process.stdin.close()
        process.stdout.close()
    for file in [sent,stdout_file,stderr_file]:
        if file:file.close()
    (OUT/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'out':str(OUT),'passed':report.get('passed',False),'checks':len(report['checks']),'error':report.get('error')},ensure_ascii=False))
if not report.get('passed'):sys.exit(1)
