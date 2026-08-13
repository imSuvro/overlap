"""Assembles the recorded frames into the README's demo GIF.

Kept as a separate step from recording so the encoding can be re-tuned — width, frame rate,
palette — without driving three browsers again.

Run with: python scripts/build-demo-gif.py
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

FRAMES_DIR = Path("scripts/.frames")
OUTPUT = Path("docs/demo.gif")
TARGET_WIDTH = 880
FRAME_MS = 110
# A GIF that takes longer than the README does to scroll past is a GIF nobody watches.
MAX_BYTES = 6_000_000


def main() -> int:
    frames = sorted(FRAMES_DIR.glob("frame-*.png"))
    if not frames:
        print(f"No frames in {FRAMES_DIR}. Run scripts/record-demo.ts first.", file=sys.stderr)
        return 1

    images: list[Image.Image] = []
    for path in frames:
        with Image.open(path) as source:
            image = source.convert("RGB")
            ratio = TARGET_WIDTH / image.width
            resized = image.resize(
                (TARGET_WIDTH, round(image.height * ratio)), Image.LANCZOS
            )
            # An adaptive palette rather than the web-safe default: the design is mostly flat
            # fills from one warm ramp, so 256 chosen colours are far more than enough and the
            # banding a fixed palette would add would land squarely on the heatmap.
            images.append(resized.convert("P", palette=Image.ADAPTIVE, colors=256))

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    first, *rest = images
    first.save(
        OUTPUT,
        save_all=True,
        append_images=rest,
        duration=FRAME_MS,
        loop=0,
        optimize=True,
        disposal=2,
    )

    size = OUTPUT.stat().st_size
    print(f"Wrote {OUTPUT} — {len(images)} frames, {size / 1_000_000:.2f} MB")
    if size > MAX_BYTES:
        print(f"Warning: larger than {MAX_BYTES / 1_000_000:.0f} MB", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
