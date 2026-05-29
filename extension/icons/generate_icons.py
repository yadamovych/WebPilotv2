#!/usr/bin/env python3
"""
Generate placeholder PNG icons for the WebPilot extension.
No external dependencies required — pure Python stdlib only.

Usage:
    python generate_icons.py
"""

import struct
import zlib
import os


def create_solid_png(width: int, height: int, color: tuple[int, int, int] = (59, 130, 246)) -> bytes:
    """Build a minimal valid PNG with a single solid color."""
    r, g, b = color

    def chunk(tag: bytes, data: bytes) -> bytes:
        payload = tag + data
        return struct.pack(">I", len(data)) + payload + struct.pack(">I", zlib.crc32(payload) & 0xFFFFFFFF)

    # IHDR: width, height, bit-depth=8, color-type=2 (RGB), compress=0, filter=0, interlace=0
    ihdr_data = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)

    # Raw image rows — each row prefixed with filter byte 0 (None)
    row = b"\x00" + bytes([r, g, b] * width)
    raw_rows = row * height

    idat_data = zlib.compress(raw_rows, level=9)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", ihdr_data)
    png += chunk(b"IDAT", idat_data)
    png += chunk(b"IEND", b"")
    return png


def main() -> None:
    out_dir = os.path.dirname(os.path.abspath(__file__))
    sizes = [16, 48, 128]
    # WebPilot brand blue
    brand_color = (59, 130, 246)

    for size in sizes:
        path = os.path.join(out_dir, f"icon{size}.png")
        data = create_solid_png(size, size, brand_color)
        with open(path, "wb") as fh:
            fh.write(data)
        print(f"  created {path}  ({size}x{size})")

    print("Done — icons generated.")


if __name__ == "__main__":
    main()
