"""
Generates icon16.png, icon32.png, icon48.png, icon128.png
No external dependencies — uses only stdlib (struct, zlib).
Run: python icons/create-icons.py
"""
import struct, zlib, os

def make_png(size):
    def pixel(x, y):
        nx, ny = x / size, y / size

        # Rounded-rect background check (corner radius ~17%)
        cr = 0.17
        clx = max(cr, min(1 - cr, nx))
        cly = max(cr, min(1 - cr, ny))
        if (nx - clx) ** 2 + (ny - cly) ** 2 > cr * cr:
            return (0, 0, 0, 0)  # transparent outside

        # Chat bubble bounds (normalised from 128px design)
        bx1, bx2 = 18 / 128, 110 / 128
        by1, by2 = 20 / 128,  90 / 128
        tx1, tx2 = 52 / 128,  70 / 128
        ty1, ty2 = 90 / 128, 110 / 128

        br = 10 / 128  # bubble corner radius

        def in_bubble():
            # Tail
            if tx1 <= nx <= tx2 and ty1 <= ny <= ty2:
                return True
            if not (bx1 <= nx <= bx2 and by1 <= ny <= by2):
                return False
            # Rounded bubble corners
            corners = [
                (bx1 + br, by1 + br),
                (bx2 - br, by1 + br),
                (bx2 - br, by2 - br),
            ]
            regions = [
                (nx < bx1 + br and ny < by1 + br, corners[0]),
                (nx > bx2 - br and ny < by1 + br, corners[1]),
                (nx > bx2 - br and ny > by2 - br, corners[2]),
            ]
            for cond, (cx, cy) in regions:
                if cond:
                    return (nx - cx) ** 2 + (ny - cy) ** 2 <= br * br
            return True

        if in_bubble():
            # Filter lines (x1,x2,y1,y2) normalised
            lines = [
                (36/128, 92/128, 44/128, 51/128),
                (44/128, 84/128, 57/128, 64/128),
                (54/128, 74/128, 70/128, 77/128),
            ]
            for lx1, lx2, ly1, ly2 in lines:
                lr = (ly2 - ly1) / 2
                lcy = (ly1 + ly2) / 2
                lcx1, lcx2 = lx1 + lr, lx2 - lr
                if ly1 <= ny <= ly2:
                    if lcx1 <= nx <= lcx2:
                        return (255, 255, 255, 240)
                    if nx < lcx1 and (nx - lcx1)**2 + (ny - lcy)**2 <= lr*lr:
                        return (255, 255, 255, 240)
                    if nx > lcx2 and (nx - lcx2)**2 + (ny - lcy)**2 <= lr*lr:
                        return (255, 255, 255, 240)
            return (139, 92, 246, 255)  # purple bubble

        return (13, 13, 26, 255)  # dark background

    raw = bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            raw.extend(pixel(x, y))

    def chunk(tag, data):
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', crc)

    return (
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', struct.pack('>II', size, size) + bytes([8, 6, 0, 0, 0]))
        + chunk(b'IDAT', zlib.compress(bytes(raw), 6))
        + chunk(b'IEND', b'')
    )

out_dir = os.path.dirname(os.path.abspath(__file__))
for sz in [16, 32, 48, 128]:
    path = os.path.join(out_dir, f'icon{sz}.png')
    with open(path, 'wb') as f:
        f.write(make_png(sz))
    print(f'OK icon{sz}.png')

print('\nDone - reload the extension in chrome://extensions')
