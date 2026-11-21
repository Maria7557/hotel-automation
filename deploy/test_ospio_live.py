import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from ospio_live import MIGRATIONS, REPO, WORKFLOW, WORKFLOW_ID, github_digest, import_zip, migration_sql, sha256


class LiveReleaseTest(unittest.TestCase):
    def test_github_provenance_requires_current_main_trusted_successful_build_and_original_digest(self):
        commit, run, artifact, digest = "a" * 40, "123", "456", "b" * 64
        inputs = {
            "/git/ref/heads/main": {"object": {"sha": commit}},
            "/actions/runs/123": {"id": 123, "workflow_id": WORKFLOW_ID, "event": "workflow_dispatch", "path": WORKFLOW,
                                  "head_branch": "main", "head_sha": commit, "head_repository": {"full_name": REPO}},
            "/actions/runs/123/jobs": {"jobs": [{"name": "build", "conclusion": "success"}]},
            "/actions/artifacts/456": {"id": 456, "expired": False, "name": "ospio-hotel-release", "digest": "sha256:" + digest,
                                      "workflow_run": {"id": 123, "head_sha": commit}},
        }
        self.assertEqual(github_digest(commit, artifact, run, inputs.__getitem__), digest)
        for path, field, fake in (
            ("/actions/runs/123", "head_branch", "unreviewed"),
            ("/actions/runs/123", "head_repository", {"full_name": "fork/hotel-automation"}),
            ("/actions/runs/123", "path", ".github/workflows/other.yml"),
            ("/actions/runs/123/jobs", "jobs", []),
            ("/actions/artifacts/456", "workflow_run", {"id": 122, "head_sha": commit}),
            ("/actions/artifacts/456", "digest", ""),
        ):
            original = inputs[path][field]
            inputs[path][field] = fake
            try:
                with self.assertRaises(ValueError):
                    github_digest(commit, artifact, run, inputs.__getitem__)
            finally:
                inputs[path][field] = original

    def test_import_rejects_tampered_or_surplus_archive(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            zipped, bundle = root / "test.zip", root / "inner"
            with zipfile.ZipFile(zipped, "w") as z:
                z.writestr("ospio-hotel-release.tar.gz", b"test")
            with self.assertRaisesRegex(ValueError, "digest"):
                import_zip(zipped, bundle, "0" * 64)
            import_zip(zipped, bundle, sha256(zipped))
            self.assertEqual(bundle.read_bytes(), b"test")
            with zipfile.ZipFile(zipped, "a") as z:
                z.writestr("../outside", b"test")
            with self.assertRaises(ValueError):
                import_zip(zipped, root / "unused", sha256(zipped))

    def test_only_reviewed_additive_migrations_can_run(self):
        root = Path(__file__).resolve().parents[1]
        db = root / "apps/server/drizzle"
        entries = json.loads((db / "meta/_journal.json").read_text())["entries"]
        history = [(str(e["when"]), sha256(db / (e["tag"] + ".sql"))) for e in entries]
        self.assertEqual(migration_sql(root, history), "")
        plan = migration_sql(root, history[:-2])
        for digest in (digest for _, digest in MIGRATIONS.values()):
            self.assertIn(digest, plan)
        self.assertIn('ADD COLUMN "widget_css"', plan)
        with self.assertRaisesRegex(ValueError, "history differs"):
            migration_sql(root, [(history[0][0], "0" * 64)])
        with self.assertRaisesRegex(ValueError, "Unreviewed"):
            migration_sql(root, history[:-3])

if __name__ == "__main__":
    unittest.main()
