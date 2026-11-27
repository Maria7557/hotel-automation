#!/usr/bin/python3
"""One-time/reviewed upgrade of the team CI receiver, run by the host administrator."""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import pwd
import re
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path

ACCOUNT = "ospio-hotel-deploy"
STATE = Path("/var/lib/ospio-hotel-deploy")
LIB = Path("/usr/local/libexec/ospio-hotel")
RECEIVER = Path("/usr/local/libexec/ospio-hotel-receive")
ENABLED = Path("/etc/ospio-hotel-deploy.enabled")
SUDOERS = Path("/etc/sudoers.d/ospio-hotel-deploy")
FILES = ("ospio_live.py", "ospio_release.py", "ospio_stage.py", "ospio_status.py")
KEY = re.compile(r"(?:^|\s)(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(?:256|384|521)) ([A-Za-z0-9+/=]+)(?:\s.*)?$")


def authorized_keys(text: str) -> str:
    """Reuse service key material, but give every key the same forced command."""
    result, seen = [], set()
    for line in text.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        match = KEY.search(line)
        if not match:
            raise ValueError("Unsupported authorized key; provide a valid CI public key")
        kind, encoded = match.groups()
        binary = base64.b64decode(encoded, validate=True)
        size = int.from_bytes(binary[:4], "big")
        if len(binary) < size + 4 or binary[4:4 + size].decode("ascii") != kind:
            raise ValueError("Public key type does not match its contents")
        identity = f"{kind} {encoded}"
        if identity not in seen:
            result.append(f'restrict,command="{RECEIVER}" {identity} ospio-github-actions')
            seen.add(identity)
    if not result:
        raise ValueError("No CI public key found")
    return "\n".join(result) + "\n"


def atomic_write(path: Path, data: bytes, mode: int, uid: int = 0, gid: int = 0) -> None:
    if path.is_symlink():
        raise ValueError(f"Refusing symlink target: {path}")
    with tempfile.NamedTemporaryFile(prefix=".ospio-", dir=path.parent, delete=False) as output:
        temporary = Path(output.name)
        try:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
            os.fchmod(output.fileno(), mode)
            os.fchown(output.fileno(), uid, gid)
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)


def root_directory(path: Path, mode: int = 0o755) -> None:
    if path.is_symlink():
        raise ValueError(f"Refusing symlink directory: {path}")
    path.mkdir(parents=True, exist_ok=True)
    os.chown(path, 0, 0)
    path.chmod(mode)


def sudoers_text() -> str:
    return (
        "# Managed by the reviewed Ospio team-deployment installer.\n"
        f'{ACCOUNT} ALL=(root) NOPASSWD: {LIB}/ospio_live.py "", {LIB}/ospio_status.py ""\n'
    )


def install(args) -> None:
    if os.getuid() != 0:
        raise ValueError("Run this installer with sudo on the Ospio server")
    if not re.fullmatch(r"[0-9a-f]{40}", args.commit):
        raise ValueError("--commit must be the reviewed 40-character GitHub main commit")
    for required in (
        "/opt/node24/bin/node", "/opt/node24/bin/npm", "/usr/sbin/runuser",
        "/usr/bin/pg_dump", "/usr/bin/pg_restore",
        "/etc/hotel-automation/server.env", "/opt/hotel-automation/current/.ospio-release.json",
        "/var/www/hotel-automation/index.html",
    ):
        if not Path(required).is_file():
            raise ValueError("Missing Ospio prerequisite: " + required)
    app = pwd.getpwnam("hotelapp")
    visudo = shutil.which("visudo")
    if not visudo:
        raise ValueError("Missing sudo prerequisite: visudo")
    for service in ("hotel-automation.service", "hotel-automation-clients.service"):
        subprocess.run(["/usr/bin/systemctl", "is-active", "--quiet", service], check=True)
    source = Path(__file__).resolve().parent
    payload = {name: (source / name).read_bytes() for name in FILES}
    payload["ospio_receive.py"] = (source / "ospio_receive.py").read_bytes()
    for name, contents in payload.items():
        compile(contents, name, "exec")
    try:
        account = pwd.getpwnam(ACCOUNT)
    except KeyError:
        if args.reuse_existing_key:
            raise ValueError("Service account missing; use --public-key for first provisioning")
        subprocess.run(["/usr/sbin/useradd", "--system", "--create-home", "--home-dir",
                        "/home/" + ACCOUNT, "--shell", "/bin/sh", ACCOUNT], check=True)
        account = pwd.getpwnam(ACCOUNT)
    if account.pw_uid == 0:
        raise ValueError("The deployment service account must not be root")
    home = Path(account.pw_dir)
    if home != Path("/home") / ACCOUNT and not (home == STATE or STATE in home.parents):
        raise ValueError("Unexpected service account home; inspect it before installing")
    keys_path = home / ".ssh/authorized_keys"
    if keys_path.is_symlink():
        raise ValueError("Inspect the service account's symlinked authorized_keys manually")
    key_source = args.public_key.read_text() if args.public_key else keys_path.read_text()
    keys = authorized_keys(key_source)
    with tempfile.TemporaryDirectory(prefix="ospio-key-check-") as temp:
        public = Path(temp) / "authorized_keys"
        public.write_text(keys)
        subprocess.run(["/usr/bin/ssh-keygen", "-l", "-f", str(public)],
                       check=True, stdout=subprocess.DEVNULL)
        sudoers = Path(temp) / "sudoers"
        sudoers.write_text(sudoers_text())
        subprocess.run([visudo, "-cf", str(sudoers)], check=True,
                       stdout=subprocess.DEVNULL)
    cache = Path("/opt/hotel-automation/.npm")
    if cache.is_symlink():
        raise ValueError("Inspect the runtime npm cache symlink before installing")
    if not cache.exists():
        cache.mkdir(mode=0o700)
        os.chown(cache, app.pw_uid, app.pw_gid)
    subprocess.run(["/usr/sbin/runuser", "-u", "hotelapp", "--", "/usr/bin/test", "-w", str(cache)],
                   check=True)
    root_directory(STATE)
    root_directory(STATE / "runner", 0o700)
    root_directory(STATE / "setup-backups", 0o700)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup = STATE / "setup-backups" / stamp
    root_directory(backup, 0o700)
    targets = [LIB / name for name in FILES] + [RECEIVER, SUDOERS, keys_path, LIB / "installed.json"]
    for index, target in enumerate(targets):
        if target.is_symlink():
            raise ValueError(f"Inspect symlink before replacing: {target}")
        if target.is_file():
            shutil.copyfile(target, backup / f"{index}-{target.name}")
    staged = STATE / "staged"
    if staged.is_symlink():
        raise ValueError("Refusing symlinked staging directory")
    staged.mkdir(exist_ok=True)
    os.chown(staged, account.pw_uid, account.pw_gid)
    staged.chmod(0o700)
    root_directory(LIB)
    root_directory(home)
    # Public authorization data must be readable when sshd temporarily assumes
    # the service UID. Root ownership prevents the account from changing it.
    root_directory(home / ".ssh", 0o755)
    for name in FILES:
        atomic_write(LIB / name, payload[name], 0o644 if name == "ospio_release.py" else 0o755)
    atomic_write(RECEIVER, payload["ospio_receive.py"], 0o755)
    atomic_write(SUDOERS, sudoers_text().encode(), 0o440)
    atomic_write(keys_path, keys.encode(), 0o644)
    metadata = {"commit": args.commit, "protocol": 1, "files": {
        name: hashlib.sha256(contents).hexdigest() for name, contents in payload.items()
    }}
    atomic_write(LIB / "installed.json", (json.dumps(metadata, sort_keys=True) + "\n").encode(), 0o644)
    restorecon = shutil.which("restorecon")
    if restorecon and home == Path("/home") / ACCOUNT:
        subprocess.run([restorecon, "-R", str(home / ".ssh")], check=True)
    if args.enable_production:
        atomic_write(ENABLED, b"Enabled for the Ospio GitHub Actions service identity.\n", 0o600)
    subprocess.run(["/usr/sbin/runuser", "-u", ACCOUNT, "--", "/usr/bin/sudo", "-n",
                    str(LIB / "ospio_status.py")], check=True)
    print("Installed team CI deployment. Run operation=status in GitHub Actions, then operation=deploy.")
    print("No developer laptop key is required. Existing server passwords were not changed.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--commit", required=True)
    keys = parser.add_mutually_exclusive_group(required=True)
    keys.add_argument("--reuse-existing-key", action="store_true")
    keys.add_argument("--public-key", type=Path)
    parser.add_argument("--enable-production", action="store_true")
    try:
        install(parser.parse_args())
    except Exception as error:
        parser.exit(1, f"Ospio deployment installation stopped: {error}\n")
