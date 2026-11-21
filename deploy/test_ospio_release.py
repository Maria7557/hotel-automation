import io
import tarfile
import tempfile
import unittest
from pathlib import Path
from ospio_release import LEGAL, prepare, safe_extract, switch_pair


class ReleaseTest(unittest.TestCase):
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
