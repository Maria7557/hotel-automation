#!/usr/bin/env python3
"""Validate an Ospio build and exercise paired source/web cutover with rollback.

Staging only: not a privileged production service or a database migrator.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import tarfile
import tempfile
from pathlib import Path, PurePosixPath
from typing import Callable

MAX_BYTES = 128 * 1024 * 1024
MAX_FILES = 20_000
LEGAL = ("privacy.html", "terms.html", "terms-it.html")
COMMIT = re.compile(r"[0-9a-f]{40}")
CHECKSUM = re.compile(r"[0-9a-f]{64}")


def sha256(path: Path) -> str:
    with path.open("rb") as source:
        digest = hashlib.sha256()
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
        return digest.hexdigest()


def safe_extract(path: Path, destination: Path, allowed: Callable[[str], bool]) -> None:
    """Only create regular files and directories; never restore tar ownership/modes."""
    destination.mkdir(parents=True, exist_ok=True)
    total, seen = 0, set()
    with tarfile.open(path, "r:gz") as archive:
        for member in archive:
            normalized = str(PurePosixPath(member.name))
            parts = PurePosixPath(member.name).parts
            if (not parts or normalized == "." or normalized.startswith("/") or ".." in parts
                    or "\\" in member.name or not allowed(normalized)
                    or any(ord(c) < 32 for c in member.name)
                    or normalized in seen or len(seen) >= MAX_FILES):
                raise ValueError(f"Invalid artifact member: {normalized!r}")
            seen.add(normalized)
            target = destination / normalized
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            if not member.isfile() or member.size < 0:
                raise ValueError(f"Unsupported archive entry: {normalized!r}")
            total += member.size
            if total > MAX_BYTES:
                raise ValueError("Expanded bundle exceeds size limit")
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.extractfile(member) as source, target.open("xb") as output:
                shutil.copyfileobj(source, output)
            target.chmod(0o644)


def prepare(bundle: Path, destination: Path, commit: str, digest: str) -> None:
    if not COMMIT.fullmatch(commit) or not CHECKSUM.fullmatch(digest):
        raise ValueError("Invalid release commit or SHA-256")
    if bundle.stat().st_size > MAX_BYTES or sha256(bundle) != digest:
        raise ValueError("Bundle checksum or size does not match")
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        raise FileExistsError(destination)
    with tempfile.TemporaryDirectory(prefix=".ospio-stage-", dir=destination.parent) as scratch:
        tmp = Path(scratch)
        safe_extract(bundle, tmp / "outer", lambda name: name in {"commit", "source.tar.gz", "build.tar.gz"})
        outer = tmp / "outer"
        if (outer / "commit").stat().st_size > 41 or (outer / "commit").read_text("ascii").strip() != commit:
            raise ValueError("Artifact commit does not match requested commit")
        tree = tmp / "candidate"
        safe_extract(outer / "source.tar.gz", tree / "source",
                     lambda name: not any(part in {".git", ".env", "node_modules", "dist"} for part in name.split("/")))
        safe_extract(outer / "build.tar.gz", tree / "built",
                     lambda n: any(n == root or n.startswith(root + "/") for root in ("apps/server/dist", "apps/mobile/dist")))
        source, built = tree / "source", tree / "built"
        for filename in ("package-lock.json", "apps/server/drizzle/meta/_journal.json"):
            if not (source / filename).is_file():
                raise ValueError(f"Missing source file: {filename}")
        for filename in ("apps/server/dist/index.js", "apps/server/dist/client-worker.js", "apps/mobile/dist/index.html"):
            if not (built / filename).is_file() or not (built / filename).stat().st_size:
                raise ValueError(f"Missing output: {filename}")
        if not list((built / "apps/mobile/dist/_expo/static/js/web").glob("*.js")):
            raise ValueError("Missing browser bundle")
        os.rename(built / "apps/server/dist", source / "apps/server/dist")
        os.rename(built / "apps/mobile/dist", tree / "web")
        shutil.rmtree(built)
        (source / ".ospio-release.json").write_text(json.dumps({"commit": commit, "repository": "Maria7557/hotel-automation", "branch": "main"}) + "\n")
        os.rename(tree, destination)


def switch_pair(old_source: Path, old_web: Path, new_source: Path, new_web: Path,
                stop: Callable[[], None], start: Callable[[], None], verify: Callable[[], None]) -> None:
    """Switch two sibling-staged directories, retain old directories even on success.

    Caller owns locks, disposable checks, DB backup, and migration validation.
    """
    pairs = [(old_source, new_source), (old_web, new_web)]
    previous = [existing.with_name(existing.name + ".previous") for existing, _ in pairs]
    for (existing, staged), saved in zip(pairs, previous):
        if (not existing.is_dir() or not staged.is_dir() or existing.is_symlink() or staged.is_symlink()
                or saved.exists() or saved.is_symlink() or existing.parent != staged.parent):
            raise ValueError("Unprepared or ambiguous cutover paths")
    for name in LEGAL:
        from_path = old_web / name
        if not from_path.is_file() or from_path.is_symlink():
            raise ValueError(f"Missing original legal page: {name}")
        destination = new_web / name
        if destination.is_symlink() or (destination.exists() and not destination.is_file()):
            raise ValueError(f"Unsafe legal page target: {name}")
        shutil.copyfile(from_path, destination)
        destination.chmod(0o644)
    moved: list[tuple[Path, Path]] = []
    stop()
    try:
        for (existing, staged), saved in zip(pairs, previous):
            os.rename(existing, saved)
            moved.append((saved, existing))
            os.rename(staged, existing)
            moved.append((existing, staged))
        start()
        verify()
    except BaseException:
        stop()
        for current, original in reversed(moved):
            os.rename(current, original)
        start()
        raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bundle", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("commit")
    parser.add_argument("checksum")
    args = parser.parse_args()
    prepare(args.bundle, args.destination, args.commit, args.checksum)
