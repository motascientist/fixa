"""Generates the Fixa icons (two overlapping cards, brand green). Run: python tools/icons.py"""
from pathlib import Path
from PIL import Image, ImageDraw

GREEN = (46, 94, 78)
PAPER = (244, 241, 234)
OUT = Path(__file__).resolve().parent.parent / "icons"


def icon(size: int, content_scale: float) -> Image.Image:
    big = size * 4  # draw large and scale down, for smooth edges
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, big, big], fill=GREEN)
    c = big * content_scale  # side of the usable square
    o = (big - c) / 2
    w, h, r = c * 0.56, c * 0.70, c * 0.09
    # back card (outline)
    x0, y0 = o + c * 0.12, o + c * 0.22
    d.rounded_rectangle([x0, y0, x0 + w, y0 + h], radius=r, outline=PAPER, width=int(c * 0.06))
    # front card (filled)
    x1, y1 = o + c * 0.34, o + c * 0.08
    d.rounded_rectangle([x1, y1, x1 + w, y1 + h], radius=r, fill=PAPER)
    return img.resize((size, size), Image.LANCZOS)


OUT.mkdir(exist_ok=True)
icon(192, 0.62).save(OUT / "icon-192.png")
icon(512, 0.62).save(OUT / "icon-512.png")
icon(512, 0.50).save(OUT / "maskable-512.png")  # Android safe zone
icon(180, 0.62).convert("RGB").save(OUT / "apple-touch-icon.png")
print("icons in", OUT)
