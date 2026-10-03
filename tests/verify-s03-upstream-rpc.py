"""Actual upstream Pi RPC preflight, no model prompt, no host credentials or cleanup.
Pass an independent install report created by prepare-s03-runtime.py.
All synthetic sessions/resources/stdout/stderr remain in a new validation run.
"""
from pathlib import Path
import datetime
import hashlib
import json
import os
import queue
import subprocess
import sys
import threading
import time

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts/validation' / ('s03-upstream-rpc-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H-%M-%S-%fZ'))
OUT.mkdir()
report = {'mode': 'real upstream 0.99.1 RPC; no prompt/model/paid call; synthetic isolated environment', 'out': str(OUT), 'checks': [], 'processes': []}
clients = []
control = None

def check(name, condition, detail=None):
    report['checks'].append({'name': name, 'ok': bool(condition), 'detail': detail})
    if not condition:
        raise AssertionError(name)

def write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding='utf-8')

def fingerprint(root):
    return {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(root.rglob('*')) if p.is_file()}

def environment(data, node):
    for folder in ['pi/agent', 'pi/sessions', 'pi/home', 'pi/appdata', 'pi/localappdata', 'pi/temp', 'workspace']:
        (data / folder).mkdir(parents=True, exist_ok=True)
    system = os.environ.get('SystemRoot', r'C:\Windows')
    return {
        'SystemRoot': system, 'WINDIR': system, 'ComSpec': str(Path(system) / 'System32/cmd.exe'),
        'PATH': os.pathsep.join([str(node.parent), str(Path(system) / 'System32'), system]),
        'HOME': str(data / 'pi/home'), 'USERPROFILE': str(data / 'pi/home'),
        'APPDATA': str(data / 'pi/appdata'), 'LOCALAPPDATA': str(data / 'pi/localappdata'),
        'TEMP': str(data / 'pi/temp'), 'TMP': str(data / 'pi/temp'),
        'PI_CODING_AGENT_DIR': str(data / 'pi/agent'), 'PI_CODING_AGENT_SESSION_DIR': str(data / 'pi/sessions'),
        'PI_PACKAGE_DIR': str(pi.parent.parent.parent),
        'PI_OFFLINE': '1', 'PI_SKIP_VERSION_CHECK': '1', 'PI_TELEMETRY': '0',
    }

class Client:
    def __init__(self, name, node, data, extra):
        self.name = name
        self.records = queue.Queue()
        self.responses = {}
        self.all_records = []
        self.number = 0
        self.closed = False
        self.errors = []
        self.env = environment(data, node)
        args = [str(node), '--no-global-search-paths', str(pi), '--mode', 'rpc', '--offline', '--no-approve', '--no-context-files', '--session-dir', str(data / 'pi/sessions'), *extra]
        self.sent = (OUT / (name + '-stdin.jsonl')).open('xb')
        self.stdout = (OUT / (name + '-stdout.jsonl')).open('xb')
        self.stderr = (OUT / (name + '-stderr.log')).open('xb')
        self.process = subprocess.Popen(args, cwd=data / 'workspace', env=self.env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.stderr)
        clients.append(self)
        self.receipt = {'name': name, 'pid': self.process.pid, 'args': args, 'environmentKeys': sorted(self.env), 'cwd': str(data / 'workspace')}
        report['processes'].append(self.receipt)
        self.reader = threading.Thread(target=self.read, daemon=True)
        self.reader.start()

    def read(self):
        # Binary readline uses LF only, preserving U+2028/U+2029 in JSON strings.
        try:
            for line in iter(self.process.stdout.readline, b''):
                self.stdout.write(line)
                self.stdout.flush()
                try:
                    record = json.loads(line.decode('utf-8'))
                    self.all_records.append(record)
                    self.records.put(record)
                except Exception as error:
                    self.errors.append(str(error))
            self.records.put({'type': '_eof'})
        except Exception as error:
            self.errors.append(str(error))
            self.records.put({'type': '_reader_error'})

    def send(self, type_, **data):
        self.number += 1
        id_ = f'{self.name}-{self.number}'
        raw = (json.dumps({'type': type_, 'id': id_, **data}, ensure_ascii=False) + '\n').encode('utf-8')
        self.sent.write(raw)
        self.sent.flush()
        self.process.stdin.write(raw)
        self.process.stdin.flush()
        return id_

    def await_response(self, id_, timeout=35):
        if id_ in self.responses:
            return self.responses.pop(id_)
        deadline = time.monotonic() + timeout
        while True:
            record = self.records.get(timeout=max(0.001, deadline - time.monotonic()))
            if record.get('type') == 'response':
                if record.get('id') == id_:
                    return record
                self.responses[record.get('id')] = record
            elif record.get('type') in ['_eof', '_reader_error']:
                raise RuntimeError(f'{self.name}: exited before {id_}; inspect retained stderr')
            if time.monotonic() >= deadline:
                raise TimeoutError(f'{self.name}: {id_}')

    def request(self, type_, **data):
        result = self.await_response(self.send(type_, **data))
        check(f'{self.name} real {type_} succeeds', result.get('success') is True, result)
        return result.get('data')

    def close(self):
        if self.closed:
            return
        self.closed = True
        if self.process.poll() is None:
            self.process.stdin.close()
        try:
            code = self.process.wait(timeout=20)
            self.receipt['normalStdinClose'] = True
        except subprocess.TimeoutExpired:
            # Specific owned PID tree only, never process-name matching.
            system = os.environ.get('SystemRoot', r'C:\Windows')
            result = subprocess.run([str(Path(system) / 'System32/taskkill.exe'), '/PID', str(self.process.pid), '/T', '/F'], capture_output=True, timeout=20)
            self.receipt['forcedOwnedTreeStop'] = {'code': result.returncode}
            code = self.process.wait(timeout=10)
            self.receipt['normalStdinClose'] = False
        self.reader.join(timeout=5)
        self.receipt['exitCode'] = code
        self.sent.close()
        self.stdout.close()
        self.stderr.close()
        self.process.stdout.close()
        if not self.process.stdin.closed:
            self.process.stdin.close()

try:
    install_path = Path(sys.argv[1]).resolve()
    install = json.loads(install_path.read_text(encoding='utf-8'))
    check('Independent runtime install succeeded', install.get('success') is True)
    node = Path(install['nodePath'])
    pi = Path(install['piPath'])
    check('Runtime paths belong to retained install only', node.is_relative_to(Path(install['out'])) and pi.is_relative_to(Path(install['out'])))
    external = OUT / 'external-pi-fixture'
    write(external / '.pi/commands/original.md', '# External command must remain unchanged\n')
    write(external / '.pi/agent/settings.json', '{"defaultModel":"EXTERNAL_NOT_A_REAL_MODEL"}\n')
    write(external / '.agents/skills/external-marker/SKILL.md', '---\nname: external-marker\ndescription: synthetic external marker not to load\n---\nExternal fixture, not a real installation.\n')
    external_before = fingerprint(external)
    # Ancestor resources that must be excluded even though the controlled cwd is below OUT.
    write(OUT / '.agents/skills/ancestor-marker/SKILL.md', '---\nname: ancestor-marker\ndescription: ancestor marker should not load\n---\nSynthetic fixture only.\n')
    write(OUT / 'AGENTS.md', 'SYNTHETIC_CONTEXT_MUST_NOT_LOAD\n')
    control_env = environment(OUT / 'control-data', node)
    control = subprocess.Popen([str(node), '-e', 'process.stdin.resume();process.stdin.on("end",()=>process.exit(0));'], env=control_env, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    report['unrelatedControlPid'] = control.pid
    no_model_data = OUT / 'empty-data'
    empty = Client('empty-default', node, no_model_data, [])
    # Source analysis said it MAY exit without a model, not that every empty catalog does.
    # Observe either a real correlated state response or a real diagnostic exit.
    try:
        empty_state = empty.request('get_state')
        empty_models = empty.request('get_available_models')
        report['emptyConfiguration'] = {'state': empty_state, 'models': empty_models}
        check('Empty configuration readiness is from actual RPC, never assumed', isinstance(empty_state.get('sessionId'), str))
    except (RuntimeError, BrokenPipeError):
        empty.process.wait(timeout=10)
        stderr = (OUT / 'empty-default-stderr.log').read_text(encoding='utf-8')
        check('Empty configuration exit reports missing model instead of fake ready', empty.process.returncode != 0 and ('model' in stderr.lower() or 'provider' in stderr.lower()), {'exit': empty.process.returncode, 'stderr': stderr})
    empty.close()
    data = OUT / 'probe-data'
    environment(data, node)
    write(data / 'pi/agent/settings.json', json.dumps({'shellPath': 'C:/Program Files/Git/bin/bash.exe', 'enableInstallTelemetry': False}))
    write(data / 'workspace/.pi/prompts/project-marker.md', '---\ndescription: must not load\n---\nSynthetic project marker\n')
    write(data / 'workspace/.pi/extensions/project-marker.ts', 'export default () => { throw new Error("PROJECT_RESOURCE_SHOULD_NOT_LOAD"); };\n')
    project_before = fingerprint(data / 'workspace/.pi')
    # Explicit unauthenticated built-in model is PROBE ONLY; never normal app readiness.
    client = Client('protocol-probe', node, data, ['--provider', 'openai', '--model', 'gpt-4o'])
    state = client.request('get_state')
    check('get_state is actual readiness, no fixed sleep', isinstance(state.get('sessionId'), str) and state.get('isStreaming') is False, state)
    session_file = Path(state['sessionFile'])
    check('Native session path stays in own data root', session_file.is_relative_to(data / 'pi/sessions'))
    ids = [client.send('get_state'), client.send('get_available_models'), client.send('get_commands')]
    # Deliberately await reverse order: correlation uses IDs, not response order.
    commands = client.await_response(ids[2])
    models = client.await_response(ids[1])
    again = client.await_response(ids[0])
    check('Concurrent RPC IDs correlate independent of consume order', all(r.get('success') for r in [commands, models, again]) and again['data']['sessionId'] == state['sessionId'])
    report['actualAvailableModelsWithoutAuth'] = models['data']['models']
    check('Probe-selected unauthenticated model not advertised as available', not any(m.get('provider') == 'openai' and m.get('id') == 'gpt-4o' for m in models['data']['models']), models)
    command_names = [c['name'] for c in commands['data']['commands']]
    check('External and ancestor/project custom resources not loaded', not any('marker' in name for name in command_names), command_names)
    check('Original built-in command capability retained', len(command_names) > 0, command_names)
    name = 'RPC preflight\u2028line\u2029paragraph'
    client.request('set_session_name', name=name)
    check('LF framing retains Unicode separator characters', client.request('get_state').get('sessionName') == name)
    result = client.request('bash', command="printf 'AZCINE_OWNED_RPC_BASH\\n'", excludeFromContext=True)
    check('Actual original Bash command runs with code 0', result['exitCode'] == 0 and 'AZCINE_OWNED_RPC_BASH' in result['output'] and not result['cancelled'], result)
    queues = client.request('clear_queue')
    check('Clear queue acknowledges actual empty queues', queues == {'steering': [], 'followUp': []}, queues)
    client.request('abort')
    client.request('abort_bash')
    messages = client.request('get_messages')['messages']
    check('No assistant/model message fabricated by preflight', not any(m.get('role') == 'assistant' for m in messages), [m.get('role') for m in messages])
    entries = client.request('get_entries')
    check('Real shell operation preserved as native session entry', any(e.get('message', {}).get('role') == 'bashExecution' for e in entries['entries']))
    client.close()
    check('RPC normal EOF shutdown and valid JSONL', client.receipt.get('normalStdinClose') and client.receipt['exitCode'] == 0 and not client.errors, client.errors)
    report['emptyNativeSessionFileExists'] = session_file.exists()
    # The original runtime defers creating a session file until a user/assistant
    # message exists. Do not invent a model answer or count a bash-only session
    # as production persistence. Feed a clearly marked native-format fixture.
    fixture_file = data / 'pi/sessions/replay-fixture.jsonl'
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    fixture_user = {'role': 'user', 'content': 'Explicit replay fixture: this message was never sent to a model.', 'timestamp': int(time.time() * 1000)}
    fixture_entries = [*entries['entries'], {'type': 'message', 'id': 'fixture1', 'parentId': entries['leafId'], 'timestamp': now, 'message': fixture_user}]
    header = {'type': 'session', 'version': 3, 'id': state['sessionId'], 'timestamp': now, 'cwd': str(data / 'workspace')}
    write(fixture_file, ''.join(json.dumps(value, ensure_ascii=False) + '\n' for value in [header, *fixture_entries]))
    report['reopenMode'] = 'Explicit native-format fixture from returned entries plus labeled unsent user message; no model reply'
    reopened = Client('reopen-probe', node, data, ['--provider', 'openai', '--model', 'gpt-4o', '--session', str(fixture_file)])
    restored = reopened.request('get_state')
    check('Actual second process opens fixture native session ID and name', restored['sessionId'] == state['sessionId'] and restored['sessionName'] == name)
    restored_messages = reopened.request('get_messages')['messages']
    check('Native fixture restores messages without inventing assistant response', restored_messages == [*messages, fixture_user])
    appended = reopened.request('bash', command="printf 'AZCINE_REOPEN_APPEND\\n'", excludeFromContext=True)
    check('Reopened fixture can persist new native shell entry', appended['exitCode'] == 0)
    reopened.close()
    persisted = [json.loads(line) for line in fixture_file.read_text(encoding='utf-8').split('\n') if line]
    check('Actual native writer appended after fixture reopen', any('AZCINE_REOPEN_APPEND' in e.get('message', {}).get('output', '') for e in persisted))
    check('Reopened RPC normal EOF shutdown', reopened.receipt.get('normalStdinClose') and reopened.receipt['exitCode'] == 0 and not reopened.errors)
    check('External fixture and skipped project resources unchanged', fingerprint(external) == external_before and fingerprint(data / 'workspace/.pi') == project_before)
    check('Unrelated owned control process still running after Pi exits', control.poll() is None)
    report['success'] = True
except Exception as error:
    report['success'] = False
    report['error'] = f'{type(error).__name__}: {error}'
    print(report['error'], file=sys.stderr)
finally:
    for client in clients:
        try:
            client.close()
        except Exception as error:
            report.setdefault('shutdownErrors', []).append(str(error))
            report['success'] = False
    if control:
        control.stdin.close()
        report['controlExitCode'] = control.wait(timeout=10)
    (OUT / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')
    print(json.dumps({'out': str(OUT), 'checks': len(report['checks']), 'success': report.get('success', False)}, ensure_ascii=False))
if not report.get('success'):
    sys.exit(1)
