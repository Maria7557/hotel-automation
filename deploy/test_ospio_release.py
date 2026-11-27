import io
import hashlib
import json
import tarfile
import tempfile
import unittest
from pathlib import Path
from ospio_release import LEGAL, prepare, safe_extract, switch_pair


class ReleaseTest(unittest.TestCase):
    def test_real_bundle_preparation_publishes_same_fe_and_be_commit(self):
        with tempfile.TemporaryDirectory() as work:
            root = Path(work)
            def archive(path, files):
                with tarfile.open(path, "w:gz") as output:
                    for name, data in files.items():
                        member = tarfile.TarInfo(name)
                        member.size = len(data)
                        output.addfile(member, io.BytesIO(data))
            archive(root / "source.tar.gz", {
                "package-lock.json": b"{}",
                "apps/server/drizzle/meta/_journal.json": b'{"entries":[]}',
            })
            archive(root / "build.tar.gz", {
                "apps/server/dist/index.js": b"console.log('api')",
                "apps/server/dist/client-worker.js": b"console.log('worker')",
                "apps/mobile/dist/index.html": b'<script src="/_expo/static/js/web/index-fixture.js"></script>',
                "apps/mobile/dist/_expo/static/js/web/index-fixture.js": b"console.log('web')",
            })
            commit = "a" * 40
            archive(root / "bundle.tar.gz", {
                "source.tar.gz": (root / "source.tar.gz").read_bytes(),
                "build.tar.gz": (root / "build.tar.gz").read_bytes(),
                "commit": (commit + "\n").encode(),
            })
            bundle = root / "bundle.tar.gz"
            prepare(bundle, root / "ready", commit, hashlib.sha256(bundle.read_bytes()).hexdigest())
            api = json.loads((root / "ready/source/.ospio-release.json").read_text())
            web = json.loads((root / "ready/web/release.json").read_text())
            self.assertEqual(api, web)
            self.assertEqual(web["commit"], commit)
            self.assertTrue((root / "ready/source/apps/server/dist/client-worker.js").is_file())

    def test_partial_service_stop_failure_attempts_recovery_without_moving_files(self):
        with tempfile.TemporaryDirectory() as work:
            root = Path(work)
            source, web, staged_source, staged_web = [root / n for n in ("api", "web", "new-api", "new-web")]
            for path in (source, web, staged_source, staged_web):
                path.mkdir()
            for page in LEGAL:
                (web / page).write_text("live legal")
            actions = []
            def stop():
                actions.append("stop")
                raise RuntimeError("second unit failed to stop")
            with self.assertRaisesRegex(RuntimeError, "second unit"):
                switch_pair(source, web, staged_source, staged_web, stop,
                            lambda: actions.append("start"), lambda: self.fail("must not switch"))
            self.assertEqual(actions, ["stop", "start"])
            self.assertTrue(source.is_dir())
            self.assertFalse((root / "api.previous").exists())

    def test_rejects_unsafe_archive_members(self):
        for name, link in (("../outside", False), ("/absolute", False), ("nested/link", True)):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as work:
                root = Path(work)
                with tarfile.open(root / "input.tar.gz", "w:gz") as archive:
                    member = tarfile.TarInfo(name)
                    if link:
                        member.type, member.linkname = tarfile.SYMTYPE, "../outside"
                    archive.addfile(member, io.BytesIO())
                with self.assertRaises(ValueError):
                    safe_extract(root / "input.tar.gz", root / "staging", lambda _: True)
                self.assertFalse((root / "outside").exists())

    def test_rejects_bad_checksum_before_extracting(self):
        with tempfile.TemporaryDirectory() as work:
            root = Path(work)
            bundle = root / "bundle"
            bundle.write_text("fixture")
            with self.assertRaisesRegex(ValueError, "checksum"):
                prepare(bundle, root / "staging", "0" * 40, "0" * 64)
            self.assertFalse((root / "staging").exists())

    def test_failed_smoke_restores_both_sides_and_keeps_live_legal_pages(self):
        for fails in (True, False):
            with self.subTest(fails=fails), tempfile.TemporaryDirectory() as work:
                root = Path(work)
                old_source, old_web, new_source, new_web = [root / n for n in ("api", "web", "api-staged", "web-staged")]
                for target, version in [(old_source, "old"), (old_web, "old"), (new_source, "new"), (new_web, "new")]:
                    target.mkdir()
                    (target / "version").write_text(version)
                for page in LEGAL:
                    (old_web / page).write_text("live legal")
                    (new_web / page).write_text("different legal")
                actions = []
                def verify():
                    self.assertEqual((old_source / "version").read_text(), "new")
                    self.assertEqual((old_web / "version").read_text(), "new")
                    self.assertTrue(all((old_web / p).read_text() == "live legal" for p in LEGAL))
                    if fails:
                        raise RuntimeError("simulated failed health check")
                callbacks = (lambda: actions.append("stop"), lambda: actions.append("start"), verify)
                if fails:
                    with self.assertRaisesRegex(RuntimeError, "failed health check"):
                        switch_pair(old_source, old_web, new_source, new_web, *callbacks)
                    self.assertEqual(actions, ["stop", "start", "stop", "start"])
                    self.assertEqual((old_source / "version").read_text(), "old")
                    self.assertEqual((old_web / "version").read_text(), "old")
                else:
                    switch_pair(old_source, old_web, new_source, new_web, *callbacks)
                    self.assertEqual(actions, ["stop", "start"])
                    self.assertEqual((root / "api.previous" / "version").read_text(), "old")
                    self.assertEqual((root / "web.previous" / "version").read_text(), "old")

if __name__ == "__main__":
    unittest.main()
