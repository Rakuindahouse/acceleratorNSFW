"""オリジナル素材（青と白のインク・絵の具風テクスチャ）を生成する。

すべてノイズから描いているので、他人の著作物を含まない。
  python3 tools/gen_textures.py <出力フォルダ> [枚数] [シード]
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

W, H = 1280, 720


def noise(rng, gw, gh, w=W, h=H):
    """なめらかなノイズ（小さい乱数格子を拡大）"""
    g = (rng.random((gh, gw)) * 255).astype(np.uint8)
    img = Image.fromarray(g, "L").resize((w, h), Image.BICUBIC)
    return np.asarray(img, np.float32) / 255


def fbm(rng, base=4, octaves=5, aspect=(1, 1), w=W, h=H):
    out = np.zeros((h, w), np.float32)
    amp, tot = 1.0, 0.0
    for i in range(octaves):
        f = base * 2 ** i
        out += amp * noise(rng, max(2, int(f * aspect[0] * w / h)), max(2, int(f * aspect[1])), w, h)
        tot += amp
        amp *= 0.5
    return out / tot


def warp(field, dx, dy):
    """dx, dy（ピクセル）だけずらして読む"""
    h, w = field.shape
    yy, xx = np.mgrid[0:h, 0:w]
    x = np.clip((xx + dx).astype(np.int32), 0, w - 1)
    y = np.clip((yy + dy).astype(np.int32), 0, h - 1)
    return field[y, x]


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


PALETTES = [
    # 白 → 水色 → 群青 → 深い紺
    [(0.0, (246, 250, 255)), (0.35, (150, 205, 245)), (0.65, (30, 80, 220)), (1.0, (6, 14, 70))],
    # 白 → 青 → 紫がかった紺
    [(0.0, (240, 244, 255)), (0.4, (120, 150, 240)), (0.7, (40, 40, 200)), (1.0, (12, 8, 60))],
    # シアン寄り
    [(0.0, (244, 252, 255)), (0.3, (120, 225, 250)), (0.6, (0, 130, 230)), (1.0, (0, 30, 110))],
    # 灰青（くすんだ空）
    [(0.0, (225, 232, 245)), (0.4, (160, 175, 210)), (0.75, (80, 95, 150)), (1.0, (30, 38, 70))],
    # コバルト一色
    [(0.0, (200, 220, 255)), (0.5, (25, 70, 235)), (1.0, (5, 20, 120))],
]


def colorize(v, pal):
    v = np.clip(v, 0, 1)
    out = np.zeros(v.shape + (3,), np.float32)
    for (p0, c0), (p1, c1) in zip(pal, pal[1:]):
        m = (v >= p0) & (v <= p1)
        t = ((v - p0) / (p1 - p0))[m][:, None]
        out[m] = np.array(c0) * (1 - t) + np.array(c1) * t
    return out


def grain(rng, img, amount=6):
    return img + (rng.random(img.shape[:2])[..., None] - 0.5) * amount


# --------------------------------------------------------------------------- 描き方
def ink_bloom(rng):
    """水に落としたインクのにじみ"""
    base = fbm(rng, base=2, octaves=6)
    wx, wy = fbm(rng, 3, 4) - 0.5, fbm(rng, 3, 4) - 0.5
    f = warp(base, wx * 260, wy * 260)
    f = warp(f, (fbm(rng, 8, 3) - 0.5) * 40, (fbm(rng, 8, 3) - 0.5) * 40)
    edge = 0.48 + rng.random() * 0.08
    fine = fbm(rng, 30, 3)
    ink = smoothstep(edge - 0.02, edge + 0.03, f + (fine - 0.5) * 0.08)
    depth = 0.55 + 0.45 * fbm(rng, 4, 4)
    return ink * depth


def drips(rng):
    """上から垂れる絵の具（太さの違う筋が下に伸び、先が丸くにじむ）"""
    yy = np.linspace(0, 1, H)[:, None]
    top = 0.12 + fbm(rng, 3, 4, aspect=(4, 0.3))[:1, :] * 0.25  # 上のたまり
    ink = smoothstep(top + 0.03, top - 0.03, yy + (fbm(rng, 25, 3) - 0.5) * 0.04)
    n = int(rng.integers(14, 34))
    xx = np.arange(W)[None, :]
    for _ in range(n):
        x = rng.uniform(0, W)
        wdt = rng.uniform(3, 26)
        end = rng.uniform(0.3, 1.05)
        wob = (fbm(rng, 3, 2, w=1, h=H)[:, :1] - 0.5) * 30
        taper = wdt * (1 - 0.6 * np.clip(yy / end, 0, 1))  # 下に行くほど細く
        col = smoothstep(taper, taper * 0.3, np.abs(xx - x - wob))
        length = smoothstep(end + 0.01, end - 0.06, yy)
        bulb = smoothstep(wdt * 0.75, wdt * 0.3, np.hypot(xx - x - wob[int(min(end, 0.99) * (H - 1))], (yy - end) * H * 1.6))
        ink = np.maximum(ink, np.maximum(col * length, bulb) * rng.uniform(0.6, 1))
    im = Image.fromarray((ink * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.5))
    ink = np.asarray(im, np.float32) / 255
    if rng.random() < 0.3:
        ink = ink[::-1]  # 下から
    return np.clip(ink * (0.65 + 0.35 * fbm(rng, 5, 4)), 0, 1)


def brush(rng):
    """刷毛で引いたような筋"""
    ang = rng.uniform(-0.4, 0.4)
    w2, h2 = int(W * 1.6), int(H * 1.6)
    vertical = rng.random() < 0.5
    streak = fbm(rng, 3, 6, aspect=(5, 0.25) if vertical else (0.15, 8), w=w2, h=h2)
    img = Image.fromarray((streak * 255).astype(np.uint8)).rotate(np.degrees(ang), Image.BICUBIC)
    l, t = (w2 - W) // 2, (h2 - H) // 2
    s = np.asarray(img.crop((l, t, l + W, t + H)), np.float32) / 255
    s = (s - s.min()) / (s.max() - s.min() + 1e-6)
    light = fbm(rng, 2, 3)
    return np.clip(0.25 + s * 0.6 + (light - 0.5) * 0.5, 0, 1)


def splatter(rng):
    """飛び散ったしぶき"""
    v = ink_bloom(rng) * 0.8
    yy, xx = np.mgrid[0:H, 0:W]
    cx, cy = rng.uniform(0.2, 0.8) * W, rng.uniform(0.2, 0.8) * H
    out = v.copy()
    for _ in range(int(rng.integers(200, 600))):
        d = rng.exponential(0.25) * W
        a = rng.uniform(0, 2 * np.pi)
        x, y = cx + np.cos(a) * d, cy + np.sin(a) * d * 0.7
        r = max(1.0, rng.exponential(3.0))
        x0, x1 = int(max(0, x - r - 2)), int(min(W, x + r + 3))
        y0, y1 = int(max(0, y - r - 2)), int(min(H, y + r + 3))
        if x0 >= x1 or y0 >= y1:
            continue
        dd = np.hypot(xx[y0:y1, x0:x1] - x, yy[y0:y1, x0:x1] - y)
        out[y0:y1, x0:x1] = np.maximum(out[y0:y1, x0:x1], smoothstep(r + 1, r - 1, dd) * rng.uniform(0.6, 1))
    return out


def marble(rng):
    """混ざりきらない青と白（マーブル）"""
    f = fbm(rng, 2, 6)
    wx, wy = fbm(rng, 2, 5) - 0.5, fbm(rng, 2, 5) - 0.5
    f = warp(f, wx * 400, wy * 400)
    bands = 0.5 + 0.5 * np.sin(f * rng.uniform(10, 22))
    return np.clip(bands * 0.85 + (fbm(rng, 6, 3) - 0.5) * 0.3, 0, 1)


STYLES = [ink_bloom, ink_bloom, drips, brush, splatter, marble]


def make(rng, i):
    style = STYLES[i % len(STYLES)]
    v = style(rng)
    if rng.random() < 0.35:
        v = 1 - v  # 白地に青ではなく、青地に白
    pal = PALETTES[int(rng.integers(len(PALETTES)))]
    img = colorize(v, pal)
    img = grain(rng, img, 5)
    im = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8), "RGB")
    if style in (ink_bloom, marble):
        im = im.filter(ImageFilter.GaussianBlur(0.6))
    return im, style.__name__


def main():
    out = Path(sys.argv[1])
    n = int(sys.argv[2]) if len(sys.argv) > 2 else 36
    seed = int(sys.argv[3]) if len(sys.argv) > 3 else 20261107
    out.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(seed)
    for i in range(n):
        im, name = make(rng, i)
        im.save(out / f"{i + 1:02d}-{name}.webp", quality=82, method=6)
        print(i + 1, name)


if __name__ == "__main__":
    main()
