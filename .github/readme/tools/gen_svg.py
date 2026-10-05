#!/usr/bin/env python3
"""Static README assets for the launch-page + bento template, in the BRIEF.md palette and typefaces.

Writes to <repo>/.github/readme/: cta-*-{dark,light}.svg, rule-{dark,light}.svg, spec-N-{dark,light}.svg,
contribute-{dark,light}.svg, outro-{dark,light}.svg. Fonts are subset to the glyphs each file uses and embedded
as base64 woff2 (GitHub blocks external refs inside SVG images). Text is measured from the font metrics so it is
centered and shrunk to fit without guessing.
"""
import base64, html, io, pathlib, sys
from fontTools import subset
from fontTools.ttLib import TTFont

S = pathlib.Path(__file__).resolve().parent / "fonts"
OUT = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path(__file__).resolve().parent.parent
FONTS = {  # key -> (weight, file)
    "display": (700, S / "fraunces-700.woff2"),
    "text": (400, S / "instrument-sans-400.woff2"),
    "semi": (600, S / "instrument-sans-600.woff2"),
    "mono": (400, S / "jetbrains-mono-400.woff2"),
}
THEMES = {
    "dark": dict(card="#211E3D", stroke="#363262", text="#FDFCFB", muted="#B1A4D6", accent="#FECE6D", line="#363262", onaccent="#363262"),
    "light": dict(card="#FEF7EC", stroke="#E8DCC5", text="#363262", muted="#605B87", accent="#FECE6D", line="#E8DCC5", onaccent="#363262"),
}
_metrics = {}


def metrics(key):
    if key not in _metrics:
        f = TTFont(FONTS[key][1])
        _metrics[key] = (f.getBestCmap(), f["hmtx"], f["head"].unitsPerEm)
    return _metrics[key]


def width(key, s, size, spacing=0.0):
    cmap, hmtx, upm = metrics(key)
    w = sum(hmtx[cmap.get(ord(c), ".notdef")][0] for c in s)
    return w / upm * size + spacing * max(len(s) - 1, 0)


def fit(key, s, size, max_w, spacing=0.0):
    """Largest font size <= size at which s fits in max_w."""
    w = width(key, s, size, spacing)
    return size if w <= max_w else size * max_w / w


def embed(key, chars):
    f = TTFont(FONTS[key][1])
    o = subset.Options()
    o.flavor = "woff2"
    o.layout_features = ["*"]
    o.notdef_outline = True
    sub = subset.Subsetter(o)
    sub.populate(text=chars)
    sub.subset(f)
    buf = io.BytesIO()
    f.flavor = "woff2"
    f.save(buf)
    return base64.b64encode(buf.getvalue()).decode()


class SVG:
    def __init__(self, w, h):
        self.w, self.h, self.parts, self.chars = w, h, [], {}

    def text(self, x, y, s, key, size, fill, anchor="start", spacing=None):
        self.chars.setdefault(key, set()).update(s)
        a = f'x="{x:.1f}" y="{y:.1f}" font-family="readme-{key}" font-weight="{FONTS[key][0]}" font-size="{size:.1f}" fill="{fill}"'
        if anchor != "start":
            a += f' text-anchor="{anchor}"'
        if spacing:
            a += f' letter-spacing="{spacing:g}"'
        self.parts.append(f"<text {a}>{html.escape(s)}</text>")

    def raw(self, s):
        self.parts.append(s)

    def save(self, name):
        faces = "".join(
            f"@font-face{{font-family:'readme-{k}';font-weight:{FONTS[k][0]};src:url(data:font/woff2;base64,{embed(k, ''.join(sorted(c)))}) format('woff2')}}"
            for k, c in self.chars.items())
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.w}" height="{self.h}" viewBox="0 0 {self.w} {self.h}">'
               f"<defs><style>{faces}</style></defs>{''.join(self.parts)}</svg>\n")
        p = OUT / name
        p.write_text(svg)
        print(f"{name}: {p.stat().st_size // 1000} KB")


def sparkle(cx, cy, r, fill):
    """A four-point sparkle, the toast's glyph; the center mark of the rule and the outro."""
    k = 0.18
    return (f'<path d="M{cx} {cy - r} Q{cx + r * k} {cy - r * k} {cx + r} {cy} Q{cx + r * k} {cy + r * k} {cx} {cy + r} '
            f'Q{cx - r * k} {cy + r * k} {cx - r} {cy} Q{cx - r * k} {cy - r * k} {cx} {cy - r} Z" fill="{fill}"/>')


# ---------- CTA buttons (48 px tall; rendered at height 44 in the README) ----------
def cta(name, label, filled):
    for theme, t in THEMES.items():
        size = 19
        w = round(width("semi", label, size) + 52)
        s = SVG(w, 48)
        if filled:
            s.raw(f'<rect x="1" y="1" width="{w - 2}" height="46" rx="12" fill="{t["accent"]}"/>')
            s.text(w / 2, 31, label, "semi", size, t["onaccent"], anchor="middle")
        else:
            stroke = t["muted"] if theme == "dark" else t["text"]
            s.raw(f'<rect x="1" y="1" width="{w - 2}" height="46" rx="12" fill="none" stroke="{stroke}" stroke-width="2"/>')
            s.text(w / 2, 31, label, "semi", size, t["text"], anchor="middle")
        s.save(f"cta-{name}-{theme}.svg")


# ---------- rule: two lines and a sparkle ----------
def rule():
    for theme, t in THEMES.items():
        s = SVG(1600, 28)
        s.raw(f'<line x1="0" y1="14" x2="772" y2="14" stroke="{t["line"]}" stroke-width="2"/>'
              f'<line x1="828" y1="14" x2="1600" y2="14" stroke="{t["line"]}" stroke-width="2"/>')
        s.raw(sparkle(800, 14, 11, t["accent"]))
        s.save(f"rule-{theme}.svg")


# ---------- spec cards: 400x250 inside a 432x270 canvas (a transparent half-gutter on every side) ----------
def spec(n, label, lines):
    """lines: list of (font key, text). One line sits at the vertical center, two lines stack."""
    for theme, t in THEMES.items():
        s = SVG(432, 270)
        s.raw(f'<g transform="translate(16,10)"><rect width="400" height="250" rx="22" fill="{t["card"]}" stroke="{t["stroke"]}" stroke-width="2"/>'
              f'<rect x="36" y="44" width="40" height="5" rx="2" fill="{t["accent"]}"/></g>')
        s.text(52, 94, label, "semi", 16, t["muted"], spacing=2.5)
        nominal = {"display": 40, "mono": 32, "text": 34}
        size = min(fit(k, txt, nominal[k], 328) for k, txt in lines)
        ys = [160] if len(lines) == 1 else [146, 194]
        for (k, txt), y in zip(lines, ys):
            s.text(52, y, txt, k, size if k != "mono" else min(size, nominal["mono"]), t["text"])
        s.save(f"spec-{n}-{theme}.svg")


# ---------- contribute card ----------
def contribute(title, line1, line2):
    for theme, t in THEMES.items():
        s = SVG(1600, 300)
        s.raw(f'<rect width="1600" height="300" rx="24" fill="{t["card"]}" stroke="{t["stroke"]}" stroke-width="2"/>'
              f'<circle cx="150" cy="150" r="64" fill="none" stroke="{t["accent"]}" stroke-width="4" stroke-dasharray="12 10"/>'
              f'<rect x="146" y="118" width="8" height="64" rx="4" fill="{t["accent"]}"/><rect x="118" y="146" width="64" height="8" rx="4" fill="{t["accent"]}"/>')
        s.text(280, 130, title, "display", 56, t["text"])
        s.text(280, 186, line1, "text", 28, t["muted"])
        s.text(280, 226, line2, "text", 28, t["muted"])
        s.save(f"contribute-{theme}.svg")


# ---------- outro strip ----------
def outro(command, line):
    for theme, t in THEMES.items():
        s = SVG(1600, 260)
        s.raw(f'<rect width="1600" height="260" rx="24" fill="{t["card"]}" stroke="{t["stroke"]}" stroke-width="2"/>')
        s.text(800, 112, command, "mono", fit("mono", command, 54, 1400), t["text"], anchor="middle")
        s.text(800, 172, line, "text", 26, t["muted"], anchor="middle")
        s.raw(sparkle(800, 220, 10, t["accent"]))
        s.save(f"outro-{theme}.svg")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    cta("start", "Get started", True)
    cta("demo", "Watch the demo", False)
    rule()
    spec(1, "INSTALL", [("mono", "opencode plugin"), ("mono", '"$PWD" -g')])
    spec(2, "REQUIRES", [("display", "OpenCode 1.18,"), ("display", "Bun 1.3 or newer")])
    spec(3, "TALKS TO", [("display", "Any OpenAI-"), ("display", "compatible /v1")])
    spec(4, "CONFIG FILE", [("mono", "prompt-optimizer.jsonc"), ("display", "re-read every message")])
    spec(5, "PER MESSAGE", [("display", "1 to 8 drafts,"), ("display", "then a judge")])
    spec(6, "DEPENDENCIES", [("display", "0 at runtime")])
    spec(7, "INSTALLED SIZE", [("display", "57 KB built")])
    spec(8, "LICENSE", [("display", "MIT")])
    contribute("Contributions are open",
               "One author so far, plus Renovate. Issues and pull requests are welcome;",
               "the commands above set up a working checkout and run the tests.")
    outro('opencode plugin "$PWD" -g', "Clone, build, add it to OpenCode. Zero runtime dependencies, MIT licensed.")
