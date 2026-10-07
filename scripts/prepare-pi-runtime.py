"""Prepare an application-owned, fully pinned upstream Pi installation.

This is installation tooling: it never starts Pi, calls a model, runs tests,
changes the host environment, or installs into a shared Worktree directory.
The candidate and original release inputs are retained for handoff.
"""
from pathlib import Path
import argparse
import base64
import datetime
import hashlib
import json
import os
import shutil
import subprocess
import tarfile
import urllib.request


def digest(path, algorithm="sha256"):
    h = hashlib.new(algorithm)
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", required=True)
    parser.add_argument("--run-dir", type=Path, required=True)
    parser.add_argument("--proxy", help="Explicit download/install proxy; host proxy environment is never inherited")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    out = args.run_dir.resolve()
    if not out.is_relative_to(root / "artifacts" / "validation"):
        raise RuntimeError("Installation evidence must stay in this Worktree")
    if not args.version or any(c not in "0123456789." for c in args.version):
        raise RuntimeError("An exact numeric upstream version is required")
    stage = out / ("installation-" + datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d-%H%M%S-%f"))
    stage.mkdir()
    report = {"version": args.version, "mode": "installation only; no Pi/model/tests", "success": False}
    try:
        old = json.loads((root / "app/resources/runtime-lock.json").read_text(encoding="utf-8"))
        original = root / "app/resources/runtime" / old["directory"]
        node_source = original / Path(old["node"]).parent
        if digest(original / old["node"]) != old["entrySha256"]["node"]:
            raise RuntimeError("Existing application-owned Node does not match its lock")
        candidate = stage / "runtime" / f"pi-{args.version}-node-{old['nodeVersion']}"
        candidate.mkdir(parents=True)
        for entry in node_source.rglob("*"):
            if entry.is_symlink() or entry.is_junction():
                raise RuntimeError("A link was found in the application Node installation")
        shutil.copytree(node_source, candidate / node_source.name)
        package = candidate / "pi"
        package.mkdir()
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({"https": args.proxy, "http": args.proxy} if args.proxy else {}))

        def download(url, destination):
            request = urllib.request.Request(url, headers={"User-Agent": "AZCine-runtime-preparation"})
            with opener.open(request, timeout=60) as response, destination.open("xb") as target:
                shutil.copyfileobj(response, target)
            return destination

        release = json.loads(download(f"https://api.github.com/repos/earendil-works/pi/releases/tags/v{args.version}", stage / "release.json").read_text(encoding="utf-8"))
        assets = {a["name"]: a for a in release["assets"]}
        for filename in ["pi-coding-agent-install-package.json", "pi-coding-agent-install-package-lock.json"]:
            asset = assets[filename]
            path = download(asset["browser_download_url"], stage / filename)
            if asset.get("digest", "").startswith("sha256:") and digest(path) != asset["digest"][7:]:
                raise RuntimeError("Official release asset integrity mismatch: " + filename)
        metadata_file = download(f"https://registry.npmjs.org/@earendil-works%2fpi-coding-agent/{args.version}", stage / "pi-metadata.json")
        metadata = json.loads(metadata_file.read_text(encoding="utf-8"))
        archive = download(metadata["dist"]["tarball"], stage / f"pi-coding-agent-{args.version}.tgz")
        sri = metadata["dist"]["integrity"].split()
        if not any(item == "sha512-" + base64.b64encode(bytes.fromhex(digest(archive, "sha512"))).decode("ascii") for item in sri):
            raise RuntimeError("Official npm archive integrity mismatch")
        shutil.copyfile(stage / "pi-coding-agent-install-package.json", package / "package.json")
        shutil.copyfile(stage / "pi-coding-agent-install-package-lock.json", package / "package-lock.json")
        lock = json.loads((package / "package-lock.json").read_text(encoding="utf-8"))
        if lock["packages"]["node_modules/@earendil-works/pi-coding-agent"]["version"] != args.version:
            raise RuntimeError("Official install lock does not select the requested version")
        lock_hash = digest(package / "package-lock.json")
        for name in ["home", "appdata", "localappdata", "temp", "npm-cache", "npm-global"]:
            (stage / name).mkdir()
        for name in ["npm-user.rc", "npm-global.rc"]:
            (stage / name).write_text("", encoding="utf-8")
        system = Path(os.environ.get("SystemRoot", r"C:\Windows"))
        node_dir = candidate / node_source.name
        env = {
            "SystemRoot": str(system), "WINDIR": str(system),
            "ComSpec": str(system / "System32/cmd.exe"),
            "PATH": os.pathsep.join([str(node_dir), str(system / "System32"), str(system)]),
            "HOME": str(stage / "home"), "USERPROFILE": str(stage / "home"),
            "APPDATA": str(stage / "appdata"), "LOCALAPPDATA": str(stage / "localappdata"),
            "TEMP": str(stage / "temp"), "TMP": str(stage / "temp"),
            "NPM_CONFIG_USERCONFIG": str(stage / "npm-user.rc"),
            "NPM_CONFIG_GLOBALCONFIG": str(stage / "npm-global.rc"),
            "NPM_CONFIG_CACHE": str(stage / "npm-cache"),
            "NPM_CONFIG_PREFIX": str(stage / "npm-global"),
            "NO_UPDATE_NOTIFIER": "1",
        }
        command = [str(node_dir / "node.exe"), str(node_dir / "node_modules/npm/bin/npm-cli.js"),
                   "ci", "--ignore-scripts", "--no-audit", "--no-fund", "--no-progress", "--omit=dev", "--registry=https://registry.npmjs.org/"]
        if args.proxy:
            command += ["--proxy=" + args.proxy, "--https-proxy=" + args.proxy]
        print(json.dumps({"installing": args.version, "candidate": str(candidate)}), flush=True)
        with (stage / "npm-install.log").open("xb") as log:
            result = subprocess.run(command, cwd=package, env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=log, timeout=600)
        report["installExitCode"] = result.returncode
        if result.returncode:
            raise RuntimeError("Independent npm ci failed; see retained npm-install.log")
        if digest(package / "package-lock.json") != lock_hash:
            raise RuntimeError("npm changed the official complete install lock")
        upstream = package / "node_modules/@earendil-works/pi-coding-agent"
        checked = 0
        with tarfile.open(archive, "r:gz") as tar:
            for member in tar.getmembers():
                if not member.isfile():
                    continue
                parts = Path(member.name).parts
                if not parts or parts[0] != "package" or ".." in parts:
                    raise RuntimeError("Unexpected official archive member")
                if (upstream.joinpath(*parts[1:])).read_bytes() != tar.extractfile(member).read():
                    raise RuntimeError("Installed Pi differs from upstream: " + member.name)
                checked += 1
        installed = json.loads((upstream / "package.json").read_text(encoding="utf-8"))
        if installed["version"] != args.version:
            raise RuntimeError("Installed Pi version mismatch")
        manifest = {"version": 1, "piVersion": args.version, "nodeVersion": old["nodeVersion"],
                    "node": old["node"], "pi": old["pi"], "packageLock": old["packageLock"]}
        manifest["entrySha256"] = {key: digest(candidate / manifest[key]) for key in ["node", "pi", "packageLock"]}
        manifest["source"] = {"pi": metadata["dist"]["tarball"], "piSha256": digest(archive),
                              "node": old["sources"]["node"], "nodeSha256": old["sources"]["nodeArchiveSha256"]}
        (candidate / "runtime-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        proposed = {key: manifest[key] for key in ["version", "piVersion", "nodeVersion", "node", "pi", "packageLock", "entrySha256"]}
        proposed["directory"] = candidate.name
        proposed["sources"] = {"pi": metadata["dist"]["tarball"], "piArchiveSha256": digest(archive),
                               "node": old["sources"]["node"], "nodeArchiveSha256": old["sources"]["nodeArchiveSha256"]}
        (stage / "proposed-runtime-lock.json").write_text(json.dumps(proposed, indent=2) + "\n", encoding="utf-8")
        report.update(success=True, candidate=str(candidate), checkedUpstreamFiles=checked,
                      installedPackages=len(lock["packages"]), manifest=manifest)
        (out / "runtime-candidate.json").write_text(json.dumps({"stage": str(stage), "candidate": str(candidate)}, indent=2) + "\n", encoding="utf-8")
    except Exception as error:
        report["error"] = str(error)
        raise
    finally:
        (stage / "installation.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
