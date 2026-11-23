import base64
import json
import os
import stat
import struct
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import ospio_actions
import ospio_status
from install_ospio_deploy import ACCOUNT, RECEIVER, atomic_write, authorized_keys, sudoers_text


def fixture_key():
    kind = b"ssh-ed25519"
    binary = struct.pack(">I", len(kind)) + kind + struct.pack(">I", 32) + b"a" * 32
    return "ssh-ed25519 " + base64.b64encode(binary).decode() + " CI-fixture"


class TeamSetupTest(unittest.TestCase):
    def test_reuses_public_material_and_restricts_every_service_key(self):
        key = fixture_key()
        value = authorized_keys('# old comment\n' + key + '\ncommand="/old/receiver" ' + key + '\n')
        self.assertEqual(value, f'restrict,command="{RECEIVER}" ' + " ".join(key.split()[:2]) + " ospio-github-actions\n")
        for wrong in ("", "-----BEGIN OPENSSH PRIVATE KEY-----", "ssh-ed25519 YWJj"):
            with self.subTest(wrong=wrong), self.assertRaises(ValueError):
                authorized_keys(wrong)

    def test_atomic_install_keeps_requested_mode_and_refuses_symlinks(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            target = root / "config"
            atomic_write(target, b"first", 0o600, os.getuid(), os.getgid())
            atomic_write(target, b"second", 0o644, os.getuid(), os.getgid())
            self.assertEqual(target.read_bytes(), b"second")
            self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o644)
            link = root / "link"
            link.symlink_to(target)
            with self.assertRaisesRegex(ValueError, "symlink"):
                atomic_write(link, b"unsafe", 0o600, os.getuid(), os.getgid())
            self.assertEqual(target.read_bytes(), b"second")

    def test_sudo_is_only_two_no_argument_helpers(self):
        rule = sudoers_text()
        self.assertIn(ACCOUNT + " ALL=(root) NOPASSWD:", rule)
        self.assertIn('ospio_live.py ""', rule)
        self.assertIn('ospio_status.py ""', rule)
        self.assertNotIn("/bin/sh", rule)
        self.assertNotIn("*", rule)

    def test_workflow_credential_is_contents_not_a_local_machine_path(self):
        for private in ("/Users/dev/.ssh/key", fixture_key(), ""):
            with self.assertRaisesRegex(ValueError, "entire multiline"):
                ospio_actions.credentials({"OSPIO_HOTEL_DEPLOY_KEY": private, "OSPIO_HOTEL_KNOWN_HOSTS": "pin"})
        private = "-----BEGIN OPENSSH PRIVATE KEY-----\r\nfixture\r\n-----END OPENSSH PRIVATE KEY-----"
        key, hosts = ospio_actions.credentials({
            "OSPIO_HOTEL_DEPLOY_KEY": private, "OSPIO_HOTEL_KNOWN_HOSTS": "ospio.online ssh-ed25519 fixture",
        })
        self.assertNotIn("\r", key)
        self.assertTrue(key.endswith("\n"))
        self.assertTrue(hosts.startswith("ospio.online "))

    def test_status_distinguishes_old_receiver_and_disabled_production(self):
        with self.assertRaisesRegex(ValueError, "one-time installer"):
            ospio_actions.validate_status({})
        value = {"protocol": 1, "repository": ospio_actions.REPO, "account": ospio_actions.ACCOUNT,
                 "host": ospio_actions.HOST, "production_enabled": False}
        self.assertEqual(ospio_actions.validate_status(value), value)
        with self.assertRaisesRegex(ValueError, "disabled"):
            ospio_actions.validate_status(value, True)
        value["production_enabled"] = True
        self.assertEqual(ospio_actions.validate_status(value, True), value)

    def test_only_own_main_can_use_ci_credentials(self):
        valid = {"GITHUB_REPOSITORY": ospio_actions.REPO, "GITHUB_REF": "refs/heads/main", "GITHUB_SHA": "a" * 40}
        self.assertEqual(ospio_actions.validate_context(valid), "a" * 40)
        for field, value in (("GITHUB_REPOSITORY", "fork/project"), ("GITHUB_REF", "refs/heads/topic"), ("GITHUB_SHA", "oops")):
            with self.assertRaises(ValueError):
                ospio_actions.validate_context({**valid, field: value})

    def test_status_exposes_only_operational_metadata(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "installed.json").write_text(json.dumps({"commit": "a" * 40}))
            (root / ".ospio-release.json").write_text(json.dumps({"commit": "b" * 40}))
            marker = root / "enabled"
            marker.write_text("private marker contents are never returned")
            with patch.object(ospio_status, "ROOT", root), patch.object(ospio_status, "SOURCE", root), \
                 patch.object(ospio_status, "ENABLED", marker), patch.object(ospio_status.subprocess, "run") as run, \
                 patch.object(ospio_status, "urlopen", side_effect=OSError("private network error")):
                run.return_value.returncode = 0
                result = ospio_status.status()
            self.assertTrue(result["production_enabled"])
            self.assertEqual(result["live_commit"], "b" * 40)
            self.assertFalse(result["api_healthy"])
            self.assertNotIn("private", json.dumps(result))

    def test_ci_status_uses_environment_key_only_then_removes_temporary_files(self):
        private = "-----BEGIN OPENSSH PRIVATE KEY-----\nCI-PRIVATE-FIXTURE\n-----END OPENSSH PRIVATE KEY-----"
        environment = {"GITHUB_REPOSITORY": ospio_actions.REPO, "GITHUB_REF": "refs/heads/main",
                       "GITHUB_SHA": "a" * 40, "OSPIO_HOTEL_DEPLOY_KEY": private,
                       "OSPIO_HOTEL_KNOWN_HOSTS": "ospio.online ssh-ed25519 fixture"}
        value = {"protocol": 1, "repository": ospio_actions.REPO, "account": ospio_actions.ACCOUNT,
                 "host": ospio_actions.HOST, "production_enabled": True, "live_commit": "a" * 40}
        saved = []
        def run(command, **kwargs):
            if command[0] == "ssh":
                key = Path(command[command.index("-i") + 1])
                self.assertEqual(stat.S_IMODE(key.stat().st_mode), 0o600)
                self.assertEqual(key.read_text().strip(), private)
                self.assertEqual(command[-1], "ospio-hotel-deploy-check")
                self.assertNotIn(private, " ".join(command))
                saved.append(key)
                return subprocess.CompletedProcess(command, 0, stdout=json.dumps(value))
            return subprocess.CompletedProcess(command, 0)
        with patch.dict(os.environ, environment, clear=True), patch.object(ospio_actions.subprocess, "run", side_effect=run), \
             patch("builtins.print"):
            ospio_actions.main("status", require_current=True)
        self.assertEqual(len(saved), 1)
        self.assertFalse(saved[0].exists())


if __name__ == "__main__":
    unittest.main()
