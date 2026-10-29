#!/usr/bin/env python3
"""Restore only regular .state files from an authenticated server backup."""
from __future__ import annotations

import argparse
import os
import tarfile
import tempfile
from pathlib import Path, PurePosixPath

MAX_BYTES = 64 * 1024 * 1024


def restore(archive: Path, root: Path) -> None:
    root = root.resolve()
    state = root / '.state'
    if state.is_symlink():
        raise ValueError('Refusing a symlinked .state directory.')
    # Validate the entire archive before touching the existing configuration.
    with tarfile.open(archive, 'r:gz') as source:
        files = []
        seen = set()
        total = 0
        for member in source:
            path = PurePosixPath(member.name)
            if path.is_absolute() or '..' in path.parts or not path.parts or path.parts[0] != '.state':
                raise ValueError('Backup contains a path outside .state.')
            if not (member.isdir() or member.isfile()):
                raise ValueError('Backup contains a link or special file.')
            if member.isdir():
                continue
            if len(path.parts) < 2 or path in seen:
                raise ValueError('Backup contains an invalid or duplicate file.')
            seen.add(path)
            total += member.size
            if total > MAX_BYTES or len(files) >= 4096:
                raise ValueError('Backup exceeds the restore limit.')
            target = root.joinpath(*path.parts)
            for candidate in (target, *target.parents):
                if candidate == root:
                    break
                if candidate.is_symlink():
                    raise ValueError('Restore destination contains a symlink.')
            files.append((member, target))
        if not files:
            raise ValueError('Backup contains no client configuration.')
        # Reject file/directory collisions before writing any configuration.
        for _, target in files:
            if target.is_dir() or any(parent.is_file() for parent in target.parents):
                raise ValueError('Restore destination conflicts with an existing file.')
        for member, _ in files:
            path = PurePosixPath(member.name)
            if any(parent in seen for parent in path.parents):
                raise ValueError('Backup contains conflicting paths.')
        state.mkdir(mode=0o700, exist_ok=True)
        state.chmod(0o700)
        for member, target in files:
            target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            fd, temporary = tempfile.mkstemp(prefix='.restore-', dir=target.parent)
            try:
                with os.fdopen(fd, 'wb') as output, source.extractfile(member) as data:
                    while chunk := data.read(1024 * 1024):
                        output.write(chunk)
                os.replace(temporary, target)
            finally:
                Path(temporary).unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    parser.add_argument('root', type=Path)
    args = parser.parse_args()
    try:
        restore(args.archive, args.root)
    except (ValueError, OSError, tarfile.TarError) as exc:
        raise SystemExit(f'Client configuration restore refused: {exc}') from exc


if __name__ == '__main__':
    main()
