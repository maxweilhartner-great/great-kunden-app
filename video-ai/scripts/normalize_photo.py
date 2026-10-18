#!/usr/bin/env python3
"""Bringt Handyfotos in eine einheitliche Form: richtig gedreht (EXIF), RGB-JPEG, max. 2400 px.

Aufruf: normalize_photo.py <eingabe> <ausgabe.jpg>
HEIC-Fotos (iPhone) werden unterstützt, wenn das Paket pillow-heif installiert ist.
"""
import sys
from PIL import Image, ImageOps

try:
    from pillow_heif import register_heif_opener

    register_heif_opener()
except ImportError:
    pass


def main(src, dst):
    img = ImageOps.exif_transpose(Image.open(src)).convert("RGB")
    img.thumbnail((2400, 2400))
    img.save(dst, "JPEG", quality=92)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
