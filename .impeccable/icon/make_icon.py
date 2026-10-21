from PIL import Image, ImageDraw, ImageFilter
import math

U = 16            # px per art pixel
G = 52            # art grid (52*16 = 832 body)
S = G * U
C = 1024
OFF = (C - S) // 2

def hx(h): return tuple(int(h[i:i+2], 16) for i in (1, 3, 5))

sky = ["#bcd3ef", "#c9dcf2", "#d8e5f5", "#e6eef8", "#f1f5fa"]
far, mid, near = "#bccbe8", "#9db8db", "#6ea9a4"
sun = "#ffb340"
cloud = "#ffffff"
accent, fold = "#0a84ff", "#0558b3"

art = Image.new("RGB", (G, G))
px = art.load()
bands = [0, 9, 18, 26, 33]
for y in range(G):
    i = max(k for k, b in enumerate(bands) if y >= b)
    for x in range(G): px[x, y] = hx(sky[i])

def put(x, y, c):
    if 0 <= x < G and 0 <= y < G: px[x, y] = hx(c)

# sun
for y in range(G):
    for x in range(G):
        if (x - 12) ** 2 + (y - 11) ** 2 <= 3.6 ** 2: put(x, y, sun)

# clouds (stepped lozenges)
def cl(cx, cy, w):
    for r, hw in enumerate([w - 2, w, w - 2]):
        for x in range(cx - hw, cx + hw + 1): put(x, cy + r, cloud)
cl(42, 31, 4); cl(36, 6, 3)

# hills: stepped profiles
def hill(base, amp, period, phase, c):
    for x in range(G):
        h = base - round(amp * math.sin((x + phase) / period * 2 * math.pi))
        h = h // 1
        for y in range(int(h), G): put(x, y, c)
hill(43, 2, 40, 6, far)
hill(45, 2, 32, 20, mid)
hill(47, 1.5, 26, 2, near)

# paper plane: three stepped facets, sampled at cell centres
def tri(p, a, b, c):
    def sg(p1, p2, p3): return (p1[0]-p3[0])*(p2[1]-p3[1]) - (p2[0]-p3[0])*(p1[1]-p3[1])
    d1, d2, d3 = sg(p, a, b), sg(p, b, c), sg(p, c, a)
    return not ((d1 < 0 or d2 < 0 or d3 < 0) and (d1 > 0 or d2 > 0 or d3 > 0))
N = (44, 11); W = (7, 24); F = (23, 29); B = (28, 40); K = (19, 35)
facets = [((N, W, F), "#5fb0ff"), ((N, F, B), accent), ((F, B, K), fold)]
for y in range(G):
    for x in range(G):
        for t, c in facets:
            if tri((x + .5, y + .5), *t): put(x, y, c)

body = art.resize((S, S), Image.NEAREST)

# squircle mask (superellipse n=5), supersampled
SS = 4
m = Image.new("L", (S*SS, S*SS), 0)
md = m.load()
n = 5.0
pts = []
for t in range(2000):
    a = t / 2000 * 2 * math.pi
    ca, sa = math.cos(a), math.sin(a)
    x = (abs(ca) ** (2/n)) * (1 if ca >= 0 else -1)
    y = (abs(sa) ** (2/n)) * (1 if sa >= 0 else -1)
    pts.append((S*SS/2 + x*S*SS/2, S*SS/2 + y*S*SS/2))
ImageDraw.Draw(m).polygon(pts, fill=255)
mask = m.resize((S, S), Image.LANCZOS)

out = Image.new("RGBA", (C, C), (0, 0, 0, 0))
# shadow
sh = Image.new("L", (C, C), 0)
sh.paste(mask, (OFF, OFF + 10))
sh = sh.filter(ImageFilter.GaussianBlur(14)).point(lambda v: int(v * 0.32))
shadow = Image.new("RGBA", (C, C), (10, 20, 50, 0)); shadow.putalpha(sh)
out = Image.alpha_composite(out, shadow)
layer = Image.new("RGBA", (C, C), (0, 0, 0, 0))
b = body.convert("RGBA"); b.putalpha(mask)
layer.paste(b, (OFF, OFF))
out = Image.alpha_composite(out, layer)
# 1px inner edge highlight
edge = mask.filter(ImageFilter.MinFilter(5))
ring = Image.new("L", (S, S), 0)
from PIL import ImageChops
ring = ImageChops.subtract(mask, edge).point(lambda v: int(v * 0.35))
rl = Image.new("RGBA", (C, C), (0,0,0,0))
white = Image.new("RGBA", (S, S), (255,255,255,255)); white.putalpha(ring)
rl.paste(white, (OFF, OFF))
out = Image.alpha_composite(out, rl)
out.save("icon-source.png")
