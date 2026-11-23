#!/usr/bin/python3
"""Ospio-only privileged runner. Installed outside repository by the host owner."""
from __future__ import annotations

import fcntl
import json
import os
import pwd
import re
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

from ospio_release import LEGAL, MAX_BYTES, prepare, sha256, switch_pair

REPO = "Maria7557/hotel-automation"
API = "https://api.github.com/repos/" + REPO
WORKFLOW = ".github/workflows/ospio-hotel-deploy.yml"
WORKFLOW_ID = 426207571
ORIGIN = "https://ospio.online"
SOURCE = Path("/opt/hotel-automation/current")
WEB = Path("/var/www/hotel-automation")
STATE = Path("/var/lib/ospio-hotel-deploy/runner")
CONFIG = Path("/etc/hotel-automation/server.env")
DATABASE = "hotel_automation"
SERVICES = ("hotel-automation.service", "hotel-automation-clients.service")
HEADER = re.compile(rb"([0-9a-f]{40}) ([1-9][0-9]{0,17}) ([1-9][0-9]{0,17})\n")
MIGRATIONS = {
    "0016_password_reset_tokens": (1794436214142, "f8655f9fde77f5ae720a91e80d9ecf8b8830c46b27ee042922f298041423002e"),
    "0017_widget_css": (1794516852401, "727ca2a80bc1a145d4f2c2da81acf0326b1aad2bc187d518f9e3fe84b4a1be20"),
}
PG = ("/usr/sbin/runuser", "-u", "postgres", "--")


def run(*args: str, **kwargs):
    return subprocess.run(args, check=True, timeout=kwargs.pop("timeout", 120), **kwargs)


def fetch_json(path: str):
    req = Request(API + path, headers={"Accept": "application/vnd.github+json", "User-Agent": "Ospio-Hotel-Deploy"})
    with urlopen(req, timeout=15) as response:
        return json.loads(response.read(2_000_000))


def github_digest(commit: str, artifact_id: str, run_id: str, fetch=fetch_json) -> str:
    if fetch("/git/ref/heads/main")["object"]["sha"] != commit:
        raise ValueError("GitHub main moved; rerun for the latest commit")
    workflow = fetch(f"/actions/runs/{run_id}")
    if (workflow.get("id") != int(run_id) or workflow.get("workflow_id") != WORKFLOW_ID
            or workflow.get("event") != "workflow_dispatch" or workflow.get("path") != WORKFLOW
            or workflow.get("head_branch") != "main" or workflow.get("head_sha") != commit
            or workflow.get("head_repository", {}).get("full_name") != REPO):
        raise ValueError("Unexpected GitHub workflow, repository, ref, or commit")
    jobs = fetch(f"/actions/runs/{run_id}/jobs")["jobs"]
    if not any(j["name"] == "build" and j["conclusion"] == "success" for j in jobs):
        raise ValueError("GitHub build job not successful")
    artifact = fetch(f"/actions/artifacts/{artifact_id}")
    linked = artifact.get("workflow_run") or {}
    digest = artifact.get("digest") or ""
    if (artifact.get("id") != int(artifact_id) or artifact.get("expired") is not False
            or artifact.get("name") != "ospio-hotel-release" or linked.get("id") != int(run_id)
            or linked.get("head_sha") != commit or not re.fullmatch(r"sha256:[0-9a-f]{64}", digest)):
        raise ValueError("Unexpected GitHub artifact")
    return digest[7:]


def import_zip(zipped: Path, bundle: Path, digest: str) -> None:
    if zipped.stat().st_size > MAX_BYTES or sha256(zipped) != digest:
        raise ValueError("Archive bytes do not match GitHub's digest")
    with zipfile.ZipFile(zipped) as archive:
        members = archive.infolist()
        if (len(members) != 1 or members[0].filename != "ospio-hotel-release.tar.gz"
                or members[0].is_dir() or members[0].file_size > MAX_BYTES
                or stat.S_ISLNK(members[0].external_attr >> 16)):
            raise ValueError("Unexpected ZIP member")
        with archive.open(members[0]) as source, bundle.open("xb") as output:
            shutil.copyfileobj(source, output)


def db_history():
    output = run(*PG, "/usr/bin/psql", "-X", "-v", "ON_ERROR_STOP=1", "-At", "-d", DATABASE,
                 "-c", "SELECT created_at::text || ':' || hash FROM drizzle.__drizzle_migrations ORDER BY created_at;",
                 capture_output=True, text=True).stdout
    return [tuple(line.split(":", 1)) for line in output.splitlines() if line]


def migration_sql(candidate: Path, history: list[tuple[str, str]]) -> str:
    directory = candidate / "apps/server/drizzle"
    journal = json.loads((directory / "meta/_journal.json").read_text())["entries"]
    expected = []
    for entry in journal:
        if not re.fullmatch(r"[0-9]{4}_[a-z0-9_]+", entry["tag"]) or not isinstance(entry["when"], int):
            raise ValueError("Unexpected migration journal entry")
        source = directory / (entry["tag"] + ".sql")
        expected.append((str(entry["when"]), sha256(source), entry["tag"], source))
    if not history or history != [(when, digest) for when, digest, _, _ in expected[:len(history)]]:
        raise ValueError("Production migration history differs from the release")
    body = ["SET LOCAL lock_timeout = '5s';", "SET LOCAL statement_timeout = '45s';"]
    for when, digest, tag, source in expected[len(history):]:
        if MIGRATIONS.get(tag) != (int(when), digest):
            raise ValueError("Unreviewed migration: " + tag)
        body.extend((source.read_text(), f"INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('{digest}', {when});"))
    return "\n".join(body) if len(body) > 2 else ""


def backup_database(destination: Path) -> None:
    with destination.open("xb") as output:
        run(*PG, "/usr/bin/pg_dump", "--format=custom", DATABASE, stdout=output)
    run("/usr/bin/pg_restore", "--list", str(destination), stdout=subprocess.DEVNULL)


def healthy(web: Path) -> None:
    for count in range(12):
        try:
            for service in SERVICES:
                run("/usr/bin/systemctl", "is-active", "--quiet", service, timeout=8)
            with urlopen("http://127.0.0.1:4200/health", timeout=6) as response:
                if json.load(response)["status"] != "ok":
                    raise ValueError("Ospio API or database still unavailable")
            break
        except Exception:
            if count == 11:
                raise
            time.sleep(2)
    # Read the actual public index and verify the new browser bundle and legal pages.
    with urlopen(ORIGIN + "/", timeout=10) as response:
        index = response.read(500_000).decode()
    match = re.search(r'(/_expo/static/js/web/[A-Za-z0-9_.-]+\.js)', index)
    if not match or not (web / match.group(1)[1:]).is_file():
        raise ValueError("Public web does not advertise this release's assets")
    for url in (match.group(1), *("/" + name for name in LEGAL)):
        with urlopen(ORIGIN + url, timeout=12) as response:
            if not response.read(64):
                raise ValueError("Empty Ospio public artifact")


def main(mode: str) -> None:
    os.umask(0o077)
    case = HEADER.fullmatch(sys.stdin.buffer.readline(150))
    if not case:
        raise ValueError("Malformed Ospio release request")
    commit, artifact, build = (part.decode("ascii") for part in case.groups())
    with (STATE / "release.lock").open("ab") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with tempfile.TemporaryDirectory(prefix="review-", dir=STATE) as temp:
            work = Path(temp)
            zipped = work / "github.zip"
            signal.alarm(180)
            try:
                with zipped.open("xb") as output:
                    remaining = MAX_BYTES
                    while chunk := sys.stdin.buffer.read(1024 * 1024):
                        remaining -= len(chunk)
                        if remaining < 0:
                            raise ValueError("Release exceeds permitted size")
                        output.write(chunk)
            finally:
                signal.alarm(0)
            digest = github_digest(commit, artifact, build)
            bundle = work / "release.tar.gz"
            import_zip(zipped, bundle, digest)
            tree = work / "candidate"
            prepare(bundle, tree, commit, sha256(bundle))
            if mode == "verify":
                migration_sql(tree / "source", db_history())
                backup_database(work / "database.dump")
                print("Verified GitHub source, build archive and database migration plan and backup; no production writes")
                return
            deploy(tree, commit)


def ownership(path: Path, uid: int, gid: int) -> None:
    for current, dirs, files in os.walk(path, followlinks=False):
        os.chown(current, uid, gid, follow_symlinks=False)
        for entry in dirs + files:
            os.chown(Path(current) / entry, uid, gid, follow_symlinks=False)


def deploy(tree: Path, commit: str) -> None:
    if not Path("/etc/ospio-hotel-deploy.enabled").is_file():
        raise RuntimeError("Live Ospio server release is disabled")
    running = json.loads((SOURCE / ".ospio-release.json").read_text())["commit"]
    if running == commit:
        healthy(WEB)
        print(f"Ospio commit {commit} is already live")
        return
    if shutil.disk_usage(SOURCE.parent).free < 3 * 1024**3:
        raise ValueError("Not enough disk space for a safe Ospio release")
    for service in SERVICES:
        run("/usr/bin/systemctl", "is-active", "--quiet", service)

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    label = f"{stamp}-{commit[:12]}"
    backup = STATE / ("backup-" + label)
    backup.mkdir(mode=0o700)
    new_source = SOURCE.with_name(".candidate-" + label)
    new_web = WEB.with_name(".ospio-candidate-" + label)
    app = pwd.getpwnam("hotelapp")
    shutil.copytree(tree / "source", new_source)
    shutil.copytree(tree / "web", new_web)
    ownership(new_source, app.pw_uid, app.pw_gid)
    ownership(new_web, app.pw_uid, app.pw_gid)
    new_source.chmod(0o700)
    for directory, _, _ in os.walk(new_web):
        Path(directory).chmod(0o755)

    def stop():
        run("/usr/bin/systemctl", "stop", *SERVICES)
    def start():
        run("/usr/bin/systemctl", "start", *SERVICES)

    # Never source shell config or install npm dependencies as root.
    run("/usr/sbin/runuser", "-u", "hotelapp", "--", "/usr/bin/env", "-i",
        "PATH=/opt/node24/bin:/usr/bin:/bin", "HOME=/opt/hotel-automation",
        "NPM_CONFIG_CACHE=/opt/hotel-automation/.npm",
        "/opt/node24/bin/npm", "ci", "--omit=dev", "--ignore-scripts",
        "--no-audit", "--no-fund", cwd=new_source, timeout=300)
    for name in ("index", "client-worker"):
        run("/usr/sbin/runuser", "-u", "hotelapp", "--", "/opt/node24/bin/node", "--check",
            str(new_source / "apps/server/dist" / (name + ".js")), timeout=30)
    db_changes = migration_sql(new_source, db_history())
    shutil.copy2(CONFIG, backup / "server.env")
    os.chmod(backup / "server.env", 0o600)
    # Verify a PostgreSQL backup before any schema changes.
    backup_database(backup / "database.dump")
    for path in (SOURCE.with_name(SOURCE.name + ".previous"), WEB.with_name(WEB.name + ".previous")):
        if path.exists() or path.is_symlink():
            raise RuntimeError("Unarchived prior release: manual inspection needed")
    if db_changes:
        # Approved changes are additive. Do not restore the DB automatically,
        # as a restore could erase writes made after the backup.
        run(*PG, "/usr/bin/psql", "-X", "-v", "ON_ERROR_STOP=1", "--single-transaction",
            "-d", DATABASE, "-f", "-", input=db_changes, text=True)
    try:
        switch_pair(SOURCE, WEB, new_source, new_web, stop, start, lambda: healthy(WEB))
    except Exception:
        # File rollback is performed by switch_pair; verify that API returned.
        healthy(WEB)
        raise
    for path in (SOURCE, WEB):
        saved = path.with_name(path.name + ".previous")
        archived = path.with_name(".ospio-retained-" + path.name + "-" + label)
        os.rename(saved, archived)
    print(f"Ospio commit {commit} deployed; API, contact worker, web and legal pages verified")


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) == 2 else "deploy" if len(sys.argv) == 1 else ""
    if os.getuid() != 0 or mode not in ("verify", "deploy"):
        sys.exit("Invalid Ospio runner invocation")
    try:
        main(mode)
    except Exception as err:
        print(f"Ospio release stopped: {err}", file=sys.stderr)
        sys.exit(1)
