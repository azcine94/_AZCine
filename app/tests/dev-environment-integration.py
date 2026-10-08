"""Windows export/deploy integration with real binaries and fictitious user state.

All outputs are retained below --output. Never reads host authentication or profiles.
No CLI model calls, installs, global configuration changes, or process-name termination.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
import zipfile

parser = argparse.ArgumentParser()
for name in ("runtime", "herdr", "node", "git", "powershell", "output"):
    parser.add_argument("--" + name, required=True)
parser.add_argument("--reuse-source", help="Previously created isolated old-user fixture; never a real user profile")
parser.add_argument("--bundle", help="Existing fixture bundle for deployment diagnosis; does not revalidate current exporter")
args = parser.parse_args()
root = Path(args.output).resolve()
root.mkdir(parents=True, exist_ok=False)
repo = Path(__file__).resolve().parents[2]
worker = root / "worker"
worker.mkdir()
for path in (repo / "app/src-tauri/resources/dev-environment").glob("*.ps1"):
    (worker / path.name).write_text(path.read_text(encoding="utf-8-sig"), encoding="utf-8-sig")
old = Path(args.reuse_source).resolve() if args.reuse_source else root / "old-user"
if args.reuse_source and not (old.parent / 'report.json').is_file():
    raise RuntimeError('Only an earlier test fixture may be reused')
new = root / "new-user"
openpi = old / "OpenPI-Sandbox"
runtime = openpi / "runtime/versions/current"
herdr = old / "programs/herdr"
tools = old / "tools"
skills = old / "skills-manager"
out = root / "exports"
for path in (out, old, new, skills, old / "workspace"):
    path.mkdir(parents=True, exist_ok=True)
evidence = []


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) if not isinstance(value, str) else value, encoding="utf-8-sig")


def check(name, condition, detail=""):
    evidence.append({"name": name, "pass": bool(condition), "detail": detail})
    write(root / "report.json", evidence)
    print(("PASS " if condition else "FAIL ") + name, flush=True)
    if not condition:
        raise AssertionError(name + ": " + detail)


def environment(user, tool_root):
    system = os.environ["SystemRoot"]
    for part in ("AppData/Roaming", "AppData/Local", "Temp", "workspace"):
        (user / part).mkdir(parents=True, exist_ok=True)
    return {
        "SystemRoot": system, "WINDIR": system,
        "COMSPEC": str(Path(system) / "System32/cmd.exe"),
        "USERPROFILE": str(user), "HOME": str(user),
        "HOMEDRIVE": user.drive, "HOMEPATH": str(user)[len(user.drive):],
        "APPDATA": str(user / "AppData/Roaming"), "LOCALAPPDATA": str(user / "AppData/Local"),
        "TEMP": str(user / "Temp"), "TMP": str(user / "Temp"),
        "USERNAME": "azcine-fixture", "USERDOMAIN": "ISOLATED",
        "PROCESSOR_ARCHITECTURE": "AMD64", "OS": "Windows_NT",
        "PATHEXT": ".COM;.EXE;.BAT;.CMD",
        "PATH": ";".join(map(str, [tool_root / "node", tool_root / "git/cmd", tool_root / "git/bin", tool_root / "powershell", Path(system) / "System32", Path(system) / "System32/WindowsPowerShell/v1.0"])),
    }


def run(name, command, env, cwd=None, timeout=600):
    start = time.monotonic()
    stdout_path, stderr_path = root / (name + '.stdout.txt'), root / (name + '.stderr.txt')
    with stdout_path.open('wb') as output, stderr_path.open('wb') as errors:
        process = subprocess.Popen(list(map(str, command)), env=env, cwd=cwd or root, stdin=subprocess.DEVNULL, stdout=output, stderr=errors, creationflags=subprocess.CREATE_NO_WINDOW)
        write(root / (name + '.running.json'), {'pid': process.pid, 'command': list(map(str, command))})
        try:
            process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=10)
            (root / (name + '.timeout.txt')).write_text('Owned process terminated after timeout.', encoding='utf-8')
    stdout, stderr = stdout_path.read_bytes(), stderr_path.read_bytes()
    completed = subprocess.CompletedProcess(command, process.returncode, stdout, stderr)
    write(root / (name + ".command.json"), {"command": list(map(str, command)), "exitCode": completed.returncode, "seconds": round(time.monotonic()-start, 2)})
    print(name + " exit=" + str(completed.returncode) + " seconds=" + str(round(time.monotonic()-start, 1)), flush=True)
    return completed


ps = Path(os.environ["SystemRoot"]) / "System32/WindowsPowerShell/v1.0/powershell.exe"
ps_args = [ps, "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"]
write(root / 'source-hashes.json', {str(path.relative_to(repo)): hashlib.sha256(path.read_bytes()).hexdigest() for path in (repo / 'app/src-tauri/resources/dev-environment').glob('*.ps1')})
if not args.reuse_source:
    print("Copying application binaries only into isolated old-user...", flush=True)
    for source, destination in [(args.runtime, runtime), (args.herdr, herdr), (args.node, tools / "node"), (args.git, tools / "git"), (args.powershell, tools / "powershell")]:
        shutil.copytree(source, destination)
        print("Copied " + str(destination.relative_to(root)), flush=True)
if not args.reuse_source:
    write(openpi / "agent/settings.json", {"packages": [{"source": "../runtime/versions/current/node_modules/@tt-a1i/openpi", "extensions": ["-extensions/workspace-cleanup-guard/index.ts", "-extensions/context-pivot/index.ts"]}], "skills": ["~/.pi/agent/skills"], "theme": "dark", "defaultThinkingLevel": "medium"})
    write(openpi / "agent/models.json", {"providers": {"fixture": {"baseUrl": "https://example.invalid/v1", "apiKey": "FAKE-SECRET-NOT-A-KEY", "headers": {"Authorization": "Bearer FAKE"}, "models": [{"id": "fictional", "name": "Fixture", "maxTokens": 8192, "contextWindow": 32000}]}}})
    write(openpi / "agent/auth.json", {"fixture": {"key": "EXCLUDED-FAKE-AUTH"}})
    write(openpi / "agent/sessions/not-for-export.jsonl", "EXCLUDED-FAKE-SESSION")
    write(openpi / "workspace/project.txt", "EXCLUDED-FAKE-PROJECT")
    write(openpi / "agent/mcp.json", {"mcpServers": {"fixture": {"command": "node", "args": [str(openpi / "agent/extensions/fixture.js")], "env": {"API_KEY": "FAKE-MCP-KEY"}}}})
    write(openpi / "agent/extensions/fixture.js", "export default function () {}\n")
    write(old / "AppData/Roaming/herdr/config.toml", '[theme]\nname = "dark"\n')
    write(old / "AppData/Roaming/herdr/session.json", "EXCLUDED-HERDR-SESSION")
    write(old / "AppData/Roaming/herdr/agent-detection/pi.toml", 'id = "pi"\nversion = "fixture"\n')
    write(skills / "example-skill/SKILL.md", "# 虚构 Skill\n仅用于隔离测试。\n")
    write(skills / ".hidden/config.json", {"fixture": True})
    (skills / "empty-directory").mkdir(exist_ok=True)
env = environment(old, tools)
paths = {"herdr": str(herdr), "openpi": str(openpi), "skills": str(skills)}
request = worker / "request.json"
write(request, paths)
result = run("inspect", ps_args + [worker / "inspect.ps1", "-RequestFile", request], env)
check("isolated discovery exits successfully", result.returncode == 0, result.stderr.decode("utf-8", "replace"))
snapshot = json.loads(result.stdout.decode("utf-8-sig"))
check("all fixture components ready", snapshot["ready"], str(snapshot["issues"]))
check("current runtime selected", Path(snapshot["runtime"]).resolve() == runtime.resolve())
before = {str(path.relative_to(openpi)): hashlib.sha256(path.read_bytes()).hexdigest() for path in (openpi / "agent").rglob("*") if path.is_file()}
if args.bundle:
    bundle = Path(args.bundle).resolve()
    write(root / 'existing-bundle.json', {'bundle': str(bundle), 'note': 'Deployment diagnosis only; bundle generated by earlier source snapshot.'})
else:
    write(request, {"paths": paths, "output": str(out)})
    result = run("export", ps_args + [worker / "export.ps1", "-RequestFile", request, "-ProgressFile", worker / "progress.json"], env)
    failure = (worker / "error.txt").read_text(encoding="utf-8-sig") if (worker / "error.txt").exists() else result.stderr.decode("utf-8", "replace")
    check("real-binary export succeeds", result.returncode == 0, failure)
    receipt = json.loads((worker / "result.json").read_text(encoding="utf-8-sig"))
    bundle = Path(receipt["output"])
check("both ZIPs finalized", all((bundle / name).is_file() for name in ["dev-environment.zip", "skills-manager.zip"]) and not (bundle / "INCOMPLETE.txt").exists())
extracted = root / "extracted"
with zipfile.ZipFile(bundle / "dev-environment.zip") as archive:
    names = archive.namelist()
    check("authentication and histories excluded", not any(name.startswith('payload/openpi/agent/sessions/') or name in {'payload/openpi/agent/auth.json', 'payload/herdr-config/session.json'} or "project.txt" in name for name in names))
    config = archive.read("payload/openpi/agent/models.json").decode("utf-8-sig")
    check("structured credentials removed", "FAKE-SECRET" not in config and "Authorization" not in config)
    check("model capabilities preserved", json.loads(config)["providers"]["fixture"]["models"][0]["maxTokens"] == 8192)
    archive.extractall(extracted)
with zipfile.ZipFile(bundle / "skills-manager.zip") as archive:
    check("skills separate and hidden files included", "skills-manager/example-skill/SKILL.md" in archive.namelist() and "skills-manager/.hidden/config.json" in archive.namelist())
    if not args.bundle:
        check("empty skill directories preserved", "skills-manager/empty-directory/" in archive.namelist())
after = {str(path.relative_to(openpi)): hashlib.sha256(path.read_bytes()).hexdigest() for path in (openpi / "agent").rglob("*") if path.is_file()}
check("source configuration untouched", before == after)
destination = new / "Installed Env"
new_env = environment(new, root / "missing-tools")
deploy_args = ps_args + [extracted / "deploy.ps1", "-InstallDirectory", destination, "-IsolatedUserDirectory", new / "fake-known-folders"]
result = run("deploy", deploy_args, new_env)
check("deploy succeeds in empty isolated destination", result.returncode == 0, result.stdout.decode("utf-8", "replace") + result.stderr.decode("utf-8", "replace"))
check("deployment receipt exists", (destination / "deployment.json").is_file() and not (destination / "DEPLOY-INCOMPLETE.txt").exists())
deployed_settings = json.loads((destination / "openpi/agent/settings.json").read_text(encoding="utf-8-sig"))
check("OpenPI source remapped and exclusions preserved", deployed_settings["packages"][0]["source"] == "..\\runtime\\node_modules\\@tt-a1i\\openpi" and len(deployed_settings["packages"][0]["extensions"]) == 2)
mcp = json.loads((destination / "openpi/agent/mcp.json").read_text(encoding="utf-8-sig"))
check("MCP paths remapped without credentials", str(destination / "openpi") in mcp["mcpServers"]["fixture"]["args"][0] and "env" not in mcp["mcpServers"]["fixture"])
profiles = new / "fake-known-folders/Documents"
check("both isolated shell profiles created", all((profiles / name / "profile.ps1").is_file() for name in ["PowerShell", "WindowsPowerShell"]))
check("isolated desktop shortcut created", (new / "fake-known-folders/Desktop/AZCine 开发环境.lnk").is_file())
for tool, command in [
    ('node', [destination / 'tools/node/node.exe', '--version']),
    ('npm', [destination / 'tools/node/node.exe', destination / 'tools/node/node_modules/npm/bin/npm-cli.js', '--version']),
    ('git', [destination / 'tools/git/cmd/git.exe', '--version']),
    ('bash', [destination / 'tools/git/bin/bash.exe', '--version']),
]:
    result = run('dependency-' + tool, command, new_env, new / 'workspace', timeout=60)
    check('packaged ' + tool + ' runs without host PATH', result.returncode == 0, result.stderr.decode('utf-8', 'replace'))
for tool in ["herdr", "opi"]:
    result = run("launch-" + tool, ps_args + [destination / "start-environment.ps1", "-Tool", tool, "--version"], new_env, new / "workspace", timeout=60)
    check(tool + " starts using packaged runtime", result.returncode == 0, result.stdout.decode("utf-8", "replace") + result.stderr.decode("utf-8", "replace"))
profile_probe = root / 'profile-probe.ps1'
write(profile_probe, ". '" + str(profiles / 'PowerShell/profile.ps1').replace("'", "''") + "'\nopi --version\nexit $LASTEXITCODE\n")
result = run('launch-profile', ps_args + [profile_probe], new_env, new / 'workspace', timeout=60)
check('registered opi command starts bundled PowerShell and runtime', result.returncode == 0, result.stdout.decode('utf-8', 'replace') + result.stderr.decode('utf-8', 'replace'))
result = run("deploy-conflict", deploy_args, new_env)
check("repeat deployment refuses overwrite", result.returncode != 0)
write(root / "summary.json", {"checks": len(evidence), "passed": sum(item["pass"] for item in evidence), "environmentZipBytes": (bundle / "dev-environment.zip").stat().st_size, "skillsZipBytes": (bundle / "skills-manager.zip").stat().st_size, "deployment": str(destination)})
print("DONE " + str(root), flush=True)
