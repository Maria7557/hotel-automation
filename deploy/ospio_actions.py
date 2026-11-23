#!/usr/bin/env python3
"""GitHub runner transport. Credentials come only from environment secrets."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = "Maria7557/hotel-automation"
HOST = "ospio.online"
ACCOUNT = "ospio-hotel-deploy"


def credentials(environment):
    private = environment.get("OSPIO_HOTEL_DEPLOY_KEY", "").replace("\r\n", "\n").strip()
    hosts = environment.get("OSPIO_HOTEL_KNOWN_HOSTS", "").strip()
    if not private.startswith("-----BEGIN OPENSSH PRIVATE KEY-----") or not private.endswith("-----END OPENSSH PRIVATE KEY-----"):
        raise ValueError("OSPIO_HOTEL_DEPLOY_KEY must contain the entire multiline OpenSSH private key, not a path or a public key")
    if not hosts:
        raise ValueError("OSPIO_HOTEL_KNOWN_HOSTS must contain the server's known_hosts line")
    return private + "\n", hosts + "\n"


def validate_context(environment):
    if environment.get("GITHUB_REPOSITORY") != REPO or environment.get("GITHUB_REF") != "refs/heads/main":
        raise ValueError("Team deployments run only from this repository's main branch")
    commit = environment.get("GITHUB_SHA", "")
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("Missing exact GitHub commit")
    return commit


def validate_status(value, require_enabled=False):
    if (value.get("protocol") != 1 or value.get("repository") != REPO
            or value.get("account") != ACCOUNT or value.get("host") != HOST):
        raise ValueError("Server receiver needs the one-time installer from deploy/TEAM_DEPLOY.md")
    if require_enabled and value.get("production_enabled") is not True:
        raise ValueError("Server production deployment is disabled. Maria must run the one-time installer with --enable-production; see deploy/TEAM_DEPLOY.md")
    return value


def main(operation: str, require_enabled=False, require_current=False):
    environment = os.environ
    commit = validate_context(environment)
    private, hosts = credentials(environment)
    if (operation == "deploy" or require_enabled) and environment.get("OSPIO_HOTEL_DEPLOY_READY") != "true":
        raise ValueError("Set environment variable OSPIO_HOTEL_DEPLOY_READY=true in ospio-hotel-production")
    with tempfile.TemporaryDirectory(prefix="ospio-ci-") as temp:
        directory = Path(temp)
        directory.chmod(0o700)
        key, known_hosts = directory / "key", directory / "known_hosts"
        key.write_text(private)
        known_hosts.write_text(hosts)
        key.chmod(0o600)
        known_hosts.chmod(0o600)
        subprocess.run(["ssh-keygen", "-y", "-P", "", "-f", str(key)], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run(["ssh-keygen", "-F", HOST, "-f", str(known_hosts)], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        ssh = ["ssh", "-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15",
               "-o", "StrictHostKeyChecking=yes", "-o", "IdentitiesOnly=yes",
               "-o", "UserKnownHostsFile=" + str(known_hosts), "-i", str(key),
               ACCOUNT + "@" + HOST]
        if operation == "status":
            result = subprocess.run(ssh + ["ospio-hotel-deploy-check"], check=True,
                                    capture_output=True, text=True, timeout=45)
            try:
                value = validate_status(json.loads(result.stdout), require_enabled)
            except json.JSONDecodeError:
                raise ValueError("Old server receiver returned non-JSON status; Maria must install deploy/TEAM_DEPLOY.md once") from None
            if require_current and value.get("live_commit") != commit:
                raise ValueError("Server backend release does not match this GitHub commit")
            print(json.dumps(value, sort_keys=True))
            summary = environment.get("GITHUB_STEP_SUMMARY")
            if summary:
                with open(summary, "a") as output:
                    output.write(f"### Ospio access check\n\nProduction enabled: **{value['production_enabled']}**\n\nLive commit: {value.get('live_commit')}\n")
            return
        if operation == "stage":
            payload = Path("ospio-hotel-release.tar.gz")
            digest = hashlib.sha256(payload.read_bytes()).hexdigest()
            command = f"ospio-hotel-stage {commit} {digest}"
        else:
            artifact, run = environment.get("OSPIO_RELEASE_ARTIFACT_ID", ""), environment.get("GITHUB_RUN_ID", "")
            if not re.fullmatch(r"[1-9][0-9]{0,17}", artifact) or not re.fullmatch(r"[1-9][0-9]{0,17}", run):
                raise ValueError("Missing GitHub artifact or run ID")
            payload = directory / "github.zip"
            with payload.open("xb") as output:
                subprocess.run(["gh", "api", f"repos/{REPO}/actions/artifacts/{artifact}/zip"],
                               check=True, stdout=output)
            command = f"ospio-hotel-deploy {commit} {artifact} {run}"
        with payload.open("rb") as source:
            subprocess.run(ssh + [command], check=True, stdin=source, timeout=900)
        if environment.get("GITHUB_STEP_SUMMARY"):
            with open(environment["GITHUB_STEP_SUMMARY"], "a") as output:
                output.write(f"### Ospio {operation} completed\n\nCommit: {commit}\n\n[Frontend release](https://ospio.online/release.json) · [Backend health](https://ospio.online/health)\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("status", "stage", "deploy"))
    parser.add_argument("--require-enabled", action="store_true")
    parser.add_argument("--require-current", action="store_true")
    args = parser.parse_args()
    try:
        main(args.operation, args.require_enabled, args.require_current)
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        message = str(error) if isinstance(error, ValueError) else "Deployment command failed; inspect the preceding server output and deploy/TEAM_DEPLOY.md"
        sys.exit("Ospio: " + message)
