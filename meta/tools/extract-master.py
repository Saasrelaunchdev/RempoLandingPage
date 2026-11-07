#!/usr/bin/env python3
"""
One-off asset tool: takes the fonts, the logo and icon symbols, the favicon and the illustrations out of the master
page (../index.html, where everything is inlined), so this site looks exactly like it. Writes:

  src/assets/fonts/outfit.woff2, geist.woff2        the two variable fonts
  src/assets/img/<name>-<width>.webp                each illustration at the widths this page uses
  src/assets/og.jpg                                  the share image (1200 x 630)
  src/assets/favicon.svg                             the Rempo mark
  src/partials/symbols.svg                           the logo and icon <symbol>s the page uses

Run it again only when the master page's pictures change:   python3 -I tools/extract-master.py
It needs Pillow. The outputs are committed, so the build itself needs nothing but Node.
"""
import base64, hashlib, io, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
MASTER = os.path.join(os.path.dirname(ROOT), "index.html")

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow is needed: pip install pillow")

src = open(MASTER, encoding="utf-8").read()

# The illustrations, found by the first 8 hex of the SHA-1 of their base64 (stable while the master page's picture
# is unchanged), named for what they show, and the widths this page asks for.
PICTURES = {
    "a3743cd8": ("street", [800, 1200]),       # a van outside Dana's house after a job
    "ef9abb80": ("podium", [800, 1200]),       # three local companies on a podium, your van on the street
    "174ad85e": ("street-six", [800, 1200]),   # a street of six homes, each with a job done this week
    "401859d9": ("house", [480, 800]),         # a technician heads back to the van; the customer waves
    "12002eb8": ("team-desk", [480, 800]),     # two people from Rempo's team at a desk with thank-you notes
    "14b182fe": ("report", [400, 640]),        # a monthly report on a clipboard
    "10e39b50": ("bell", [320, 480]),          # an alert bell
    "a93c6b94": ("crew", [480, 640]),          # a crew of three in front of their van (the request's team photo)
    "311fe598": ("notes", [400, 640]),         # a pile of notes: asking by hand
    "2f0a01bd": ("toolbox", [400, 640]),       # a toolbox: a tool you run
    "7fbe9750": ("mark-3d", [400, 640]),       # the Rempo mark in 3D: a service that runs
}

out_img = os.path.join(ROOT, "src", "assets", "img")
os.makedirs(out_img, exist_ok=True)
found = {}
for m in re.finditer(r'src="data:image/webp;base64,([A-Za-z0-9+/=]+)"', src):
    data = m.group(1)
    key = hashlib.sha1(data.encode()).hexdigest()[:8]
    if key in PICTURES and key not in found:
        found[key] = Image.open(io.BytesIO(base64.b64decode(data))).convert("RGBA")

missing = [PICTURES[k][0] for k in PICTURES if k not in found]
if missing:
    sys.exit(f"Not found in the master page: {', '.join(missing)}. Its pictures changed: update PICTURES.")

for key, (name, widths) in PICTURES.items():
    im = found[key]
    for w in widths:
        h = round(im.height * w / im.width)
        im.resize((w, h), Image.LANCZOS).save(os.path.join(out_img, f"{name}-{w}.webp"), "WEBP", quality=82, method=6)
    print(f"{name}: {im.width}x{im.height} -> {widths}")

# The share image: the podium on the page's light canvas
podium = found["ef9abb80"]
og = Image.new("RGB", (1200, 630), (255, 255, 255))
w = 1080
h = round(podium.height * w / podium.width)
pic = podium.resize((w, h), Image.LANCZOS)
og.paste(pic, ((1200 - w) // 2, (630 - h) // 2 + 10), pic)
og.save(os.path.join(ROOT, "src", "assets", "og.jpg"), "JPEG", quality=84, optimize=True, progressive=True)

# Fonts
out_fonts = os.path.join(ROOT, "src", "assets", "fonts")
os.makedirs(out_fonts, exist_ok=True)
for fam, data in re.findall(r'font-family: "([A-Za-z]+)".*?url\(data:font/woff2;base64,([A-Za-z0-9+/=]+)\)', src, re.S):
    open(os.path.join(out_fonts, f"{fam.lower()}.woff2"), "wb").write(base64.b64decode(data))
    print(f"font {fam}")

# Favicon
fav = re.search(r'<link rel="icon" href="data:image/svg\+xml;base64,([A-Za-z0-9+/=]+)"', src)
if fav:
    open(os.path.join(ROOT, "src", "assets", "favicon.svg"), "wb").write(base64.b64decode(fav.group(1)))

# Symbols: the logo, plus every icon this page names
ICONS = ["i-check", "i-arrow", "i-down", "i-x", "i-star", "i-starf", "i-reply", "i-send", "i-search", "i-bell",
         "i-clock", "i-phone", "i-mail", "i-alert", "i-lock", "i-plug", "i-list", "i-file", "i-van"]
sprite = re.search(r'<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">\s*<defs>(.*?)</defs>', src, re.S).group(1)
keep = []
for sym in re.findall(r'(<symbol id="([^"]+)".*?</symbol>)', sprite, re.S):
    body, sid = sym
    if sid in ICONS or sid in ("logo-mark", "logo-h"):
        keep.append(body)
grad = re.search(r'<linearGradient id="g-forward".*?</linearGradient>', sprite, re.S)
if grad:
    keep.insert(0, grad.group(0))
os.makedirs(os.path.join(ROOT, "src", "partials"), exist_ok=True)
open(os.path.join(ROOT, "src", "partials", "symbols.svg"), "w", encoding="utf-8").write("\n".join(keep) + "\n")
print(f"symbols: {len(keep)}")
