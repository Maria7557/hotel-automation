#!/usr/bin/python3
"""Validate and retain a candidate using only the dedicated deployment account."""
import fcntl
import os
import re
import signal
import sys
import tempfile
from pathlib import Path

from ospio_release import MAX_BYTES, prepare

STAGED = Path("/var/lib/ospio-hotel-deploy/staged")


def stage():
    match = re.fullmatch(r"ospio-hotel-stage ([0-9a-f]{40}) ([0-9a-f]{64})",
                         os.environ.get("SSH_ORIGINAL_COMMAND", ""))
    if not match or len(sys.argv) != 1:
        raise ValueError("Stage command not permitted")
    commit, digest = match.groups()
    os.umask(0o077)
    with (STAGED / ".lock").open("ab") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with tempfile.TemporaryDirectory(prefix=".upload-", dir=STAGED) as temp:
            bundle = Path(temp) / "release.tar.gz"
            remaining = MAX_BYTES
            signal.alarm(180)
            try:
                with bundle.open("xb") as output:
                    while chunk := sys.stdin.buffer.read(1024 * 1024):
                        remaining -= len(chunk)
                        if remaining < 0:
                            raise ValueError("Release exceeds permitted size")
                        output.write(chunk)
            finally:
                signal.alarm(0)
            candidate = Path(temp) / "candidate"
            prepare(bundle, candidate, commit, digest)
            destination = STAGED / (commit + "-" + digest)
            if not destination.exists():
                os.rename(candidate, destination)
            print(f"Ospio commit {commit} staged; production unchanged")


if __name__ == "__main__":
    try:
        stage()
    except Exception as error:
        sys.exit(f"Ospio staging stopped: {error}")
