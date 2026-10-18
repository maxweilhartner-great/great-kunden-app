#!/usr/bin/env python3
"""Erzeugt aus dem offiziellen GR·EAT-Logo (PDF mit Schnittmarken) alle Varianten für die App.

Aufruf: prepare_logo.py brand/GREAT-Logo-Slogan-PAN-364C.pdf
Benötigt pdftocairo (poppler-utils) und Pillow.

Ergebnis in brand/:
  logo-full.png   Logo mit Slogan, transparent (Original-Grün Pantone 364C)
  logo-mark.png   nur Wortmarke „GR·EAT“, transparent
  logo.png        Wortmarke auf hellem Schild – kleines Logo oben links im Reel
  logo-outro.png  Logo mit Slogan auf hellem Schild – Abspann am Ende des Reels
und public/logo-white.png (weiße Wortmarke für die dunkle Kopfzeile der Web-App).
"""
import os
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BRAND = os.path.join(ROOT, "brand")
PAPER = (246, 243, 234)


def render(src):
    if src.lower().endswith(".png"):
        return Image.open(src).convert("RGBA")
    with tempfile.TemporaryDirectory() as tmp:
        out = os.path.join(tmp, "logo")
        subprocess.run(["pdftocairo", "-png", "-transp", "-r", "600", "-singlefile", src, out], check=True)
        img = Image.open(out + ".png").convert("RGBA")
        img.load()
    # Schnittmarken sitzen am Rand des PDFs → nur den Innenbereich verwenden
    w, h = img.size
    return img.crop((int(w * 0.09), int(h * 0.16), int(w * 0.91), int(h * 0.84)))


def trim(img):
    return img.crop(img.getchannel("A").getbbox())


def split_wordmark(logo):
    """Wortmarke endet an der ersten breiten, leeren Spalte (danach kommt der Slogan)."""
    alpha = logo.getchannel("A")
    w, h = logo.size
    min_gap = int(w * 0.04)
    run = 0
    for x in range(int(w * 0.3), w):
        empty = all(alpha.getpixel((x, y)) == 0 for y in range(0, h, 2))
        run = run + 1 if empty else 0
        if run >= min_gap:
            return trim(logo.crop((0, 0, x - run, h)))
    return logo


def plate(img, width, pad_x, pad_y, opacity=240):
    img = img.resize((width, round(img.height * width / img.width)), Image.LANCZOS)
    w, h = img.width + 2 * pad_x, img.height + 2 * pad_y
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(out).rounded_rectangle((0, 0, w - 1, h - 1), radius=min(h // 2, 48), fill=PAPER + (opacity,))
    out.alpha_composite(img, (pad_x, pad_y))
    return out


def main(src):
    full = trim(render(src))
    mark = split_wordmark(full)
    full.save(os.path.join(BRAND, "logo-full.png"))
    mark.save(os.path.join(BRAND, "logo-mark.png"))
    plate(mark, 440, 44, 30).save(os.path.join(BRAND, "logo.png"))
    plate(full, 760, 70, 60, opacity=250).save(os.path.join(BRAND, "logo-outro.png"))

    white = Image.new("RGBA", mark.size, (255, 255, 255, 0))
    white.putalpha(mark.getchannel("A"))
    white = white.resize((240, round(mark.height * 240 / mark.width)), Image.LANCZOS)
    white.save(os.path.join(ROOT, "public", "logo-white.png"))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(BRAND, "GREAT-Logo-Slogan-PAN-364C.pdf"))
