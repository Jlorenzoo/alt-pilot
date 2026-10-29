#!/usr/bin/env python3
"""Build the calculator's item-sprite atlas from rendered Minecraft item icons.

The calculator preset dialog needs an icon for every Minecraft item. Rendered
inventory icons (not raw textures, which are flat and wrong for blocks) come
from Owen1212055/mc-assets, a native render of all items at 256x256.

Outputs, both served statically by control_center.py:
  web/items.json       catalog: item id -> display name + atlas cell index
  web/items-atlas.png  packed grid of CELL x CELL icons

Run:
  python3 tools/build_item_atlas.py                 # shallow-clones the source
  python3 tools/build_item_atlas.py --source DIR    # use an existing checkout

Re-run when the source repo updates or the Minecraft version changes.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

CELL = 48
SOURCE_REPO = "https://github.com/Owen1212055/mc-assets.git"
SOURCE_SUBDIR = "item-assets"

ROOT = Path(__file__).resolve().parents[1]
OUT_PNG = ROOT / "web" / "items-atlas.png"
OUT_JSON = ROOT / "web" / "items.json"

ACRONYMS = {"tnt", "xp", "dvd"}


def prettify(item_id: str) -> str:
    return " ".join(p.upper() if p in ACRONYMS else p.capitalize() for p in item_id.split("_"))


def clone_source() -> tuple[Path, str]:
    tmp = Path(tempfile.mkdtemp(prefix="mc-item-atlas-"))
    subprocess.run(["git", "clone", "--depth", "1", SOURCE_REPO, str(tmp / "repo")],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    sha = subprocess.run(["git", "-C", str(tmp / "repo"), "rev-parse", "HEAD"],
                         check=True, capture_output=True, text=True).stdout.strip()
    return tmp / "repo" / SOURCE_SUBDIR, sha


def build(source: Path, source_ref: str) -> None:
    from PIL import Image

    names = sorted(f[:-4].lower() for f in os.listdir(source)
                   if f.endswith(".png") and f[:-4].upper() != "AIR")
    if not names:
        sys.exit(f"no item pngs found in {source}")

    cols = math.ceil(math.sqrt(len(names)))
    rows = math.ceil(len(names) / cols)
    atlas = Image.new("RGBA", (cols * CELL, rows * CELL), (0, 0, 0, 0))
    for index, item_id in enumerate(names):
        icon = Image.open(source / f"{item_id.upper()}.png").convert("RGBA")
        icon = icon.resize((CELL, CELL), Image.LANCZOS)
        atlas.paste(icon, ((index % cols) * CELL, (index // cols) * CELL))

    # Rendered icons have smooth gradients: an adaptive 256-colour palette takes
    # the 4.5 MB RGBA atlas down to ~0.7 MB with no visible loss at display size.
    atlas.quantize(colors=256, method=Image.FASTOCTREE).save(OUT_PNG, optimize=True)

    catalog = {
        "file": OUT_PNG.name,
        "cell": CELL,
        "cols": cols,
        "rows": rows,
        "source": f"Owen1212055/mc-assets@{source_ref}",
        "items": [[item_id, prettify(item_id)] for item_id in names],
    }
    OUT_JSON.write_text(json.dumps(catalog, separators=(",", ":")), encoding="utf-8")
    print(f"{len(names)} items -> {OUT_JSON.name} ({OUT_JSON.stat().st_size // 1024} KB), "
          f"{OUT_PNG.name} ({OUT_PNG.stat().st_size // 1024} KB), grid {cols}x{rows}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, help="existing item-assets directory")
    parser.add_argument("--source-ref", default="unknown", help="source commit to record")
    args = parser.parse_args()

    cleanup = None
    if args.source:
        build(args.source, args.source_ref)
        return
    source, sha = clone_source()
    cleanup = source.parents[1]
    try:
        build(source, sha)
    finally:
        if cleanup:
            shutil.rmtree(cleanup, ignore_errors=True)


if __name__ == "__main__":
    main()
