"""Small isolated filesystem fixtures for exporter/deployer failure boundaries."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import zipfile

root = Path(sys.argv[1]).resolve()
root.mkdir(parents=True, exist_ok=False)
repo = Path(__file__).resolve().parents[2]
worker = root / "worker"
worker.mkdir()
for script in (repo / "app/src-tauri/resources/dev-environment").glob("*.ps1"):
    (worker / script.name).write_text(script.read_text(encoding="utf-8-sig"), encoding="utf-8-sig")
user = root / "fake-user"
node = user / "tools/node"
git = user / "tools/git"
op = user / "OpenPI-Sandbox"
herdr = user / "Herdr"
skills = user / "skills"
runtime = op / "runtime/versions/active"
output = root / "exports"
report = []


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value if isinstance(value, str) else json.dumps(value), encoding="utf-8-sig")


def check(name, result):
    report.append({"name": name, "pass": bool(result)})
    write(root / "report.json", report)
    print(("PASS " if result else "FAIL ") + name, flush=True)
    if not result:
        raise AssertionError(name)


for path in (node / "node.exe", git / "cmd/git.exe", git / "bin/bash.exe", herdr / "herdr.exe", herdr / "conpty/conpty.dll"):
    write(path, "FAKE BINARY - never executed")
write(runtime / "node_modules/@tt-a1i/openpi/package.json", {"version": "fixture-openpi"})
write(runtime / "node_modules/@earendil-works/pi-coding-agent/package.json", {"version": "fixture-pi"})
write(runtime / "node_modules/@tt-a1i/openpi/runtime.txt", "ACTIVE-RUNTIME")
write(op / "runtime/node_modules/old.txt", "OLD-RUNTIME-EXCLUDED")
write(op / "agent/settings.json", {"packages": ["../runtime/versions/active/node_modules/@tt-a1i/openpi"], "skills": ["~/.pi/agent/skills"]})
write(op / "agent/auth.json", {"key": "FAKE-NEVER-EXPORT"})
write(op / "agent/sessions/session.jsonl", "EXCLUDE-ME")
write(op / "agent/models.json", {"maxTokens": 16384, "apiKey": "FAKE-SECRET"})
write(skills / "example/SKILL.md", "# Fixture")
write(skills / ".hidden/file.txt", "hidden")
(skills / "empty").mkdir()
for path in (user / "Temp", user / "AppData/Roaming", output):
    path.mkdir(parents=True, exist_ok=True)
system = Path(os.environ["SystemRoot"])
env = {"SystemRoot": str(system), "WINDIR": str(system), "USERPROFILE": str(user), "HOME": str(user), "APPDATA": str(user / "AppData/Roaming"), "LOCALAPPDATA": str(user / "AppData/Local"), "TEMP": str(user / "Temp"), "TMP": str(user / "Temp"), "PROCESSOR_ARCHITECTURE": "AMD64", "PATHEXT": ".EXE;.CMD;.BAT", "PATH": ";".join(map(str, (node, git / "cmd", system / "System32", system / "System32/WindowsPowerShell/v1.0")))}
prefix = [system / "System32/WindowsPowerShell/v1.0/powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"]
paths = {"herdr": str(herdr), "openpi": str(op), "skills": str(skills)}
request = worker / "request.json"


def run(name, script, arguments):
    command = list(map(str, prefix + [script] + arguments))
    if name == 'small-deploy':
        # Exercise the actual double-click entry point; EOF dismisses its final pause.
        command = '"' + str(system / 'System32/cmd.exe') + '" /d /s /c ""' + str(script.with_suffix('.cmd')) + '" ' + ' '.join('"' + str(item) + '"' for item in arguments) + '"'
    result = subprocess.run(command, env=env, cwd=root, stdin=subprocess.DEVNULL, capture_output=True, timeout=60, creationflags=subprocess.CREATE_NO_WINDOW)
    (root / (name + ".stdout.txt")).write_bytes(result.stdout)
    (root / (name + ".stderr.txt")).write_bytes(result.stderr)
    write(root / (name + ".command.json"), {"command": command, "exitCode": result.returncode})
    return result


write(request, {**paths, "skills": str(user / "missing")})
result = run("missing-source", worker / "inspect.ps1", ["-RequestFile", request])
check("missing source blocks ready state", result.returncode == 0 and not json.loads(result.stdout.decode("utf-8-sig"))["ready"])
write(request, {"paths": paths, "output": str(skills)})
result = run("recursive-output", worker / "export.ps1", ["-RequestFile", request, "-ProgressFile", worker / "progress.json"])
check("output inside source rejected", result.returncode != 0 and not list(skills.glob("azcine-dev-*")))
write(request, {"paths": paths, "output": str(output)})
result = run("small-export", worker / "export.ps1", ["-RequestFile", request, "-ProgressFile", worker / "progress.json"])
if result.returncode:
    print((worker / 'error.txt').read_text(encoding='utf-8-sig'), flush=True)
check("synthetic export succeeds", result.returncode == 0)
bundle = Path(json.loads((worker / "result.json").read_text(encoding="utf-8-sig"))["output"])
with zipfile.ZipFile(bundle / "dev-environment.zip") as archive:
    names = archive.namelist()
    check("only active runtime included", "payload/openpi/runtime/node_modules/@tt-a1i/openpi/runtime.txt" in names and not any(name.endswith("old.txt") for name in names))
    check("known credential and session files excluded", not any(name.endswith("auth.json") or name.endswith("session.jsonl") for name in names))
    check("deploy cmd has no BOM", archive.read("deploy.cmd").startswith(b"@echo off\r\n"))
    check("model properties retained while key removed", json.loads(archive.read("payload/openpi/agent/models.json").decode("utf-8-sig")) == {"maxTokens": 16384})
    extracted = root / "extracted"
    archive.extractall(extracted)
with zipfile.ZipFile(bundle / "skills-manager.zip") as archive:
    check("skills preserve hidden files and empty directories", "skills-manager/empty/" in archive.namelist() and "skills-manager/.hidden/file.txt" in archive.namelist())
installed = root / "new-user/Installed Env"
isolated = root / "new-user/known-folders"
result = run("small-deploy", extracted / "deploy.ps1", ["-InstallDirectory", installed, "-IsolatedUserDirectory", isolated])
if result.returncode:
    print(result.stdout.decode("utf-8", "replace"), result.stderr.decode("utf-8", "replace"), flush=True)
check("deploy.cmd handles a target with spaces without launching fake binaries", result.returncode == 0 and (installed / "deployment.json").is_file())
before = hashlib.sha256((installed / "deployment.json").read_bytes()).hexdigest()
result = run("existing-target", extracted / "deploy.ps1", ["-InstallDirectory", installed, "-IsolatedUserDirectory", isolated])
check("existing target refused without changes", result.returncode != 0 and before == hashlib.sha256((installed / "deployment.json").read_bytes()).hexdigest())
(extracted / "payload/herdr/herdr.exe").write_bytes(b"TAMPERED-FIXTURE")
result = run("corrupted-payload", extracted / "deploy.ps1", ["-InstallDirectory", root / "corrupt-target", "-IsolatedUserDirectory", root / "corrupt-user"])
check("corrupt payload refused before installing", result.returncode != 0 and not (root / "corrupt-target").exists())
# Cancellation kills only the exporter process we just created; files remain marked incomplete.
with (runtime / "large-fixture.bin").open('wb') as stream:
    stream.truncate(256 * 1024 * 1024)
previous = set(output.iterdir())
process = subprocess.Popen(list(map(str, prefix + [worker / "export.ps1", "-RequestFile", request, "-ProgressFile", worker / "cancel-progress.json"])), env=env, cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW)
deadline = time.monotonic() + 20
cancelled = None
try:
    while time.monotonic() < deadline and process.poll() is None:
        candidates = set(output.iterdir()) - previous
        if candidates:
            cancelled = next(iter(candidates))
            if (cancelled / "INCOMPLETE.txt").exists():
                process.kill()
                break
        time.sleep(.025)
finally:
    if process.poll() is None:
        process.kill()
    process.wait(timeout=10)
check("cancelled exporter retains incomplete output", cancelled is not None and (cancelled / "INCOMPLETE.txt").exists() and not (cancelled / "export-result.json").exists())
write(root / 'source-hashes.json', {str(path.relative_to(repo)): hashlib.sha256(path.read_bytes()).hexdigest() for path in (repo / 'app/src-tauri/resources/dev-environment').glob('*.ps1')})
print("DONE " + str(root), flush=True)
