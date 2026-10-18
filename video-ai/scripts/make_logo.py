#!/usr/bin/env python3
"""Erzeugt ein transparentes GR·EAT-Logo-Overlay (Ring + Wortmarke) für die Reels.

Aufruf: make_logo.py brand/logo.png
Wer das offizielle Logo hat, legt es einfach als brand/logo.png ab (PNG mit Transparenz).
"""
import sys
from PIL import Image, ImageDraw, ImageFont

FOREST = (31, 61, 46, 235)
GREEN = (63, 122, 78, 255)
MANGO = (233, 138, 46, 255)
PAPER = (246, 243, 234, 255)

FONTS = [
    "/usr/share/fonts/opentype/inter/Inter-Bold.otf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]


def font(size):
    for path in FONTS:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def main(out):
    scale = 4  # supersampling für saubere Kanten
    h = 150 * scale
    img = Image.new("RGBA", (h, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    f = font(int(h * 0.42))
    parts = (("GR", PAPER), ("·", MANGO), ("EAT", PAPER))
    gap = int(4 * scale)
    text_w = sum(d.textlength(p, font=f) + gap for p, _ in parts)
    w = int(h + 10 * scale + text_w + h * 0.3)
    img = img.resize((w, h))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, w - 1, h - 1), radius=h // 2, fill=FOREST)

    # Ring wie im App-Icon: grün mit Mango-Segment oben links
    cx, cy, r, stroke = h // 2, h // 2, int(h * 0.32), int(h * 0.075)
    box = (cx - r, cy - r, cx + r, cy + r)
    d.arc(box, start=0, end=360, fill=GREEN, width=stroke)
    d.arc(box, start=225, end=270, fill=MANGO, width=stroke)

    x = h + int(10 * scale)
    y = h // 2
    for part, color in parts:
        d.text((x, y), part, font=f, fill=color, anchor="lm")
        x += d.textlength(part, font=f) + gap

    img = img.resize((img.width // scale, img.height // scale), Image.LANCZOS)
    img.save(out)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "brand/logo.png")
