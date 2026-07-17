"""Build fixed-platform Xiangqi glyph templates from a reference screenshot."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image


BOARD_BOX = (699, 69, 1848, 1343)
CANONICAL_SIZE = (900, 1000)
GRID_LEFT = 61.0
GRID_TOP = 54.0
GRID_STEP_X = 97.5
GRID_STEP_Y = 98.2
TEMPLATE_SIZE = 64

SAMPLES = {
    "red": {
        "car": [(0, 0), (7, 8)],
        "horse": [(1, 0), (6, 2)],
        "elephant": [(4, 2), (8, 2)],
        "advisor": [(3, 0), (5, 0)],
        "general": [(5, 1)],
        "cannon": [(0, 2), (6, 7)],
        "soldier": [(0, 3), (8, 4)],
    },
    "black": {
        "car": [(8, 9)],
        "horse": [(3, 5), (7, 9)],
        "elephant": [(4, 7), (2, 9)],
        "advisor": [(3, 9), (5, 9)],
        "general": [(4, 9)],
        "cannon": [(6, 3), (4, 5)],
        "soldier": [(3, 3), (0, 5), (4, 6), (8, 6)],
    },
}


def glyph_mask(image: Image.Image, side: str) -> Image.Image:
    pixels = np.asarray(image, dtype=np.int16)
    red = pixels[:, :, 0]
    green = pixels[:, :, 1]
    blue = pixels[:, :, 2]

    if side == "red":
        mask = (
            (red > 75)
            & (red < 205)
            & (green < 105)
            & (blue < 100)
            & ((red - green) > 32)
            & ((red - blue) > 28)
        )
    else:
        mask = (
            (red < 95)
            & (green < 105)
            & (blue < 110)
            & ((red + green + blue) < 260)
        )

    yy, xx = np.ogrid[: mask.shape[0], : mask.shape[1]]
    center_x = (mask.shape[1] - 1) / 2
    center_y = (mask.shape[0] - 1) / 2
    glyph_radius = TEMPLATE_SIZE * 0.43
    mask &= (xx - center_x) ** 2 + (yy - center_y) ** 2 <= glyph_radius**2

    return Image.fromarray(np.where(mask, 255, 0).astype(np.uint8), mode="L")


def grid_center(x: int, y: int) -> tuple[int, int]:
    return round(GRID_LEFT + x * GRID_STEP_X), round(GRID_TOP + y * GRID_STEP_Y)


def crop_center(image: Image.Image, center: tuple[int, int], size: int) -> Image.Image:
    half = size // 2
    x, y = center
    return image.crop((x - half, y - half, x + half, y + half))


def build_templates(source_path: Path, output_dir: Path) -> None:
    source = Image.open(source_path).convert("RGB")
    if source.size != (2549, 1403):
        raise ValueError(
            f"Reference screenshot must be 2549x1403, got {source.width}x{source.height}."
        )

    board = source.crop(BOARD_BOX).resize(CANONICAL_SIZE, Image.Resampling.LANCZOS)
    output_dir.mkdir(parents=True, exist_ok=True)

    manifest = {
        "version": 1,
        "platform": "fixed-wood-xiangqi",
        "canonicalBoard": {
            "width": CANONICAL_SIZE[0],
            "height": CANONICAL_SIZE[1],
            "aspectRatio": CANONICAL_SIZE[0] / CANONICAL_SIZE[1],
        },
        "grid": {
            "left": GRID_LEFT,
            "top": GRID_TOP,
            "stepX": GRID_STEP_X,
            "stepY": GRID_STEP_Y,
        },
        "templateSize": TEMPLATE_SIZE,
        "templates": [],
    }

    for side, kinds in SAMPLES.items():
        for kind, positions in kinds.items():
            for index, position in enumerate(positions, start=1):
                patch = crop_center(board, grid_center(*position), TEMPLATE_SIZE)
                mask = glyph_mask(patch, side)
                filename = f"{side}-{kind}-{index}.png"
                mask.save(output_dir / filename, optimize=True)
                manifest["templates"].append(
                    {
                        "side": side,
                        "kind": kind,
                        "file": filename,
                    }
                )

    (output_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("public/assets/piece-templates"),
    )
    args = parser.parse_args()
    build_templates(args.source, args.output)


if __name__ == "__main__":
    main()
