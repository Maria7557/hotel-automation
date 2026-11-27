#!/usr/bin/python3
"""Read-only status for the GitHub deployment identity; never return secrets."""
import json
import os
import subprocess
import sys
from pathlib import Path
from urllib.request import urlopen

ROOT = Path("/usr/local/libexec/ospio-hotel")
ENABLED = Path("/etc/ospio-hotel-deploy.enabled")
SOURCE = Path("/opt/hotel-automation/current")
SERVICES = ("hotel-automation.service", "hotel-automation-clients.service")


def status():
    installed = json.loads((ROOT / "installed.json").read_text())
    try:
        live = json.loads((SOURCE / ".ospio-release.json").read_text()).get("commit")
    except (OSError, ValueError):
        live = None
    services = {
        service: subprocess.run(["/usr/bin/systemctl", "is-active", "--quiet", service],
                                timeout=10, check=False).returncode == 0
        for service in SERVICES
    }
    try:
        with urlopen("http://127.0.0.1:4200/health", timeout=6) as response:
            health = json.load(response).get("status") == "ok"
    except Exception:
        health = False
    return {
        "protocol": 1, "repository": "Maria7557/hotel-automation",
        "host": "ospio.online", "account": "ospio-hotel-deploy",
        "production_enabled": ENABLED.is_file(),
        "installed_commit": installed["commit"], "live_commit": live,
        "services": services, "api_healthy": health,
    }


if __name__ == "__main__":
    if len(sys.argv) != 1 or os.getuid() != 0:
        sys.exit("Status helper requires the installed no-argument sudo command")
    print(json.dumps(status(), sort_keys=True))
