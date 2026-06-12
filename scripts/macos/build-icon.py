#!/usr/bin/env python3
"""Build FlowX.icns with macOS-style squircle + dock-safe outer margin."""
from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "pillow", "-q"])
    from PIL import Image, ImageDraw

CANVAS = 1024
# Inset the whole icon ~8% so pywebview dock size matches system apps.
OUTER_INSET = 82
INNER = CANVAS - 2 * OUTER_INSET
INNER_RADIUS = int(226 * INNER / CANVAS)


def squircle_mask(size: int, inset: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    box = [inset, inset, size - inset - 1, size - inset - 1]
    draw.rounded_rectangle(box, radius=radius, fill=255)
    return mask


def render_svg(svg: Path, size: int, out_png: Path) -> None:
    tmp = out_png.parent
    subprocess.run(
        ["qlmanage", "-t", "-s", str(size), "-o", str(tmp), str(svg)],
        check=True,
        capture_output=True,
    )
    rendered = tmp / f"{svg.name}.png"
    if not rendered.is_file():
        raise SystemExit(f"qlmanage did not produce {rendered}")
    shutil.move(str(rendered), str(out_png))


def compose_icon(src_png: Path, out_png: Path) -> None:
    base = Image.open(src_png).convert("RGBA").resize((CANVAS, CANVAS), Image.Resampling.LANCZOS)
    # Scale artwork into inner safe zone, centered on transparent canvas.
    scaled = base.resize((INNER, INNER), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    canvas.paste(scaled, (OUTER_INSET, OUTER_INSET))
    mask = squircle_mask(CANVAS, OUTER_INSET, INNER_RADIUS)
    icon = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    icon.paste(canvas, (0, 0), mask)
    icon.save(out_png, format="PNG")


def write_icns(png: Path, icns: Path) -> None:
    tmp = Path(tempfile.mkdtemp(prefix="flowx-icon-"))
    iconset = tmp / "FlowX.iconset"
    iconset.mkdir()
    shutil.copy(png, iconset / "icon_512x512@2x.png")
    for size in (16, 32, 128, 256, 512):
        for scale, suffix in ((1, ""), (2, "@2x")):
            px = size * scale
            out = iconset / f"icon_{size}x{size}{suffix}.png"
            Image.open(png).resize((px, px), Image.Resampling.LANCZOS).save(out, format="PNG")
    subprocess.run(["iconutil", "-c", "icns", str(iconset), "-o", str(icns)], check=True)
    shutil.rmtree(tmp)


def main() -> None:
    here = Path(__file__).resolve().parent
    svg = here / "icons" / "flowx-dock.svg"
    icns = here / "FlowX.app" / "Contents" / "Resources" / "FlowX.icns"
    tmp = Path(tempfile.mkdtemp(prefix="flowx-icon-"))
    try:
        raw = tmp / "raw.png"
        final = tmp / "final.png"
        render_svg(svg, CANVAS, raw)
        compose_icon(raw, final)
        write_icns(final, icns)
        print(f"Wrote {icns}")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
