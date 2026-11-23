#!/usr/bin/python3
"""Forced-command wrapper for the dedicated Ospio GitHub SSH key."""
import os
import re
import shutil
import subprocess
import sys

command = os.environ.get("SSH_ORIGINAL_COMMAND", "")
stage = "/usr/local/libexec/ospio-hotel-stage"
if command == "ospio-hotel-deploy-check" or re.fullmatch(
        r"ospio-hotel-stage [0-9a-f]{40} [0-9a-f]{64}", command):
    os.execv(stage, [stage])

match = re.fullmatch(r"ospio-hotel-deploy ([0-9a-f]{40}) ([1-9][0-9]{0,17}) ([1-9][0-9]{0,17})", command)
if not match:
    sys.exit("Command not permitted")
with subprocess.Popen(["/usr/bin/sudo", "-n", "/usr/local/libexec/ospio-hotel/ospio_live.py"], stdin=subprocess.PIPE) as runner:
    try:
        with runner.stdin as output:
            output.write((" ".join(match.groups()) + "\n").encode("ascii"))
            shutil.copyfileobj(sys.stdin.buffer, output)
    except BrokenPipeError:
        pass
    raise SystemExit(runner.wait())
