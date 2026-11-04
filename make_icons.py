"""Generates the app icons (ruled notepad paper with a single ink dot). No dependencies."""
import os, struct, zlib

PAPER = (243, 238, 227)
RULE = (214, 205, 184)
MARGIN = (216, 185, 176)
INK = (43, 41, 37)

def png(path, size, scale):
    # scale < 1 shrinks the artwork toward the centre (for the maskable safe zone)
    rows = []
    cx = cy = size / 2
    r = size * 0.17 * scale
    lines = [size * (0.5 + k * 0.14 * scale) for k in (-3, -2, -1, 0, 1, 2, 3)]
    margin_x = size * (0.5 - 0.30 * scale)
    lw = max(1.0, size * 0.006)
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            col = PAPER
            if abs(x + 0.5 - margin_x) < lw * 0.8:
                col = MARGIN
            for ly in lines:
                if abs(y + 0.5 - ly) < lw * 0.8:
                    col = RULE
            # anti-aliased ink dot (4x4 supersampling)
            hit = 0
            for sy in range(4):
                for sx in range(4):
                    dx = x + (sx + .5) / 4 - cx
                    dy = y + (sy + .5) / 4 - cy
                    if dx * dx + dy * dy <= r * r:
                        hit += 1
            a = hit / 16
            if a:
                col = tuple(round(col[i] * (1 - a) + INK[i] * a) for i in range(3))
            row += bytes(col)
        rows.append(bytes(row))
    raw = b''.join(rows)

    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

    data = (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9))
            + chunk(b'IEND', b''))
    with open(path, 'wb') as f:
        f.write(data)

here = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'icons')
os.makedirs(here, exist_ok=True)
png(os.path.join(here, 'icon-192.png'), 192, 1.0)
png(os.path.join(here, 'icon-512.png'), 512, 1.0)
png(os.path.join(here, 'icon-maskable-512.png'), 512, 0.8)
print('icons written to', here)
