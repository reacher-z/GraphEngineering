#!/usr/bin/env python3
"""Render docs/assets/demo.gif and docs/assets/demo.svg from tools/demo/capture.json.

Every frame is a pure function of capture.json, which is itself produced by a
real run of the research-diamond pattern bundle (see tools/demo/capture.mjs).
Nothing on screen is hand-animated or invented: node states, journal lines,
the concurrency indicator and every number on the closing card come straight
from the captured event sequence and run results.

Deterministic: no clock, no randomness, no network, no screen recording.

Usage:
    python tools/demo/render.py [--out-dir docs/assets] [--previews DIR]

Requires Pillow (any recent version). Fonts: DejaVu (falls back to the PIL
default if not installed).
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent.parent

# ---------------------------------------------------------------------------
# Palette — the repo hero palette (docs/assets/graph-engineering-hero.svg)
# ---------------------------------------------------------------------------

BG_TOP = (8, 20, 39)        # #081427
BG_MID = (16, 38, 80)       # #102650
BG_BOT = (18, 33, 58)       # #12213a
GRID = (125, 211, 252)      # #7dd3fc (used at low alpha)
INK = (248, 250, 252)       # #f8fafc
INK_SOFT = (186, 230, 253)  # #bae6fd
INK_MUTED = (148, 163, 184) # #94a3b8
SKY = (56, 189, 248)        # #38bdf8   scope / started
VIOLET = (167, 139, 250)    # #a78bfa   accents / edges emitted
INDIGO = (129, 140, 248)    # #818cf8   source nodes
TEAL = (94, 234, 212)       # #5eead4   barrier / succeeded
EDGE = (102, 217, 239)      # #66d9ef
SCOPE_FILL = (8, 47, 73)    # #082f49
SOURCE_FILL = (23, 37, 84)  # #172554
SYNTH_FILL = (4, 47, 46)    # #042f2e
PANEL_FILL = (5, 13, 28)
PANEL_EDGE = (30, 58, 95)

W, H = 960, 540

# ---------------------------------------------------------------------------
# Timeline
# ---------------------------------------------------------------------------

INTRO_S = 1.3        # opening hold
STEP_S = 0.43        # seconds per committed event
SETTLE_S = 0.8       # hold after the last event
CLOSER_STEP_S = 0.6  # staged reveal of the closing card
CLOSER_HOLD_S = 3.6  # final hold

REPO_LINE = "github.com/reacher-z/GraphEngineering · v0.2.0-alpha.2"

# ---------------------------------------------------------------------------
# Geometry
# ---------------------------------------------------------------------------

SCOPE_C = (92, 281)
SCOPE_R = 36
SOURCE_W, SOURCE_H = 152, 48
SOURCE_CX = 268
SOURCE_CY = {"source-code": 143, "source-docs": 281, "source-web": 419}
SYNTH_C = (432, 281)
SYNTH_HW, SYNTH_HH = 58, 46
JOURNAL = (512, 92, 932, 470)  # x0, y0, x1, y1
JOURNAL_LINE_H = 24
JOURNAL_TOP = 132
JOURNAL_MAX_LINES = 14

EVENT_COLOR = {
    "RunCreated": INK,
    "RunStarted": INK,
    "RunSucceeded": TEAL,
    "NodeScheduled": INK_MUTED,
    "NodeStarted": SKY,
    "NodeSucceeded": TEAL,
    "EdgeEmitted": VIOLET,
}


def load_fonts():
    base = Path("/usr/share/fonts/truetype/dejavu")
    try:
        return {
            "title": ImageFont.truetype(str(base / "DejaVuSans-Bold.ttf"), 30),
            "mono13": ImageFont.truetype(str(base / "DejaVuSansMono.ttf"), 13),
            "mono15": ImageFont.truetype(str(base / "DejaVuSansMono.ttf"), 15),
            "mono16": ImageFont.truetype(str(base / "DejaVuSansMono.ttf"), 16),
            "mono16b": ImageFont.truetype(str(base / "DejaVuSansMono-Bold.ttf"), 16),
            "mono18b": ImageFont.truetype(str(base / "DejaVuSansMono-Bold.ttf"), 18),
            "big": ImageFont.truetype(str(base / "DejaVuSans-Bold.ttf"), 40),
        }
    except OSError:
        fallback = ImageFont.load_default()
        return {k: fallback for k in ("title", "mono13", "mono15", "mono16", "mono16b", "mono18b", "big")}


FONTS = load_fonts()


# ---------------------------------------------------------------------------
# State reconstruction — a pure function of the captured event prefix
# ---------------------------------------------------------------------------

def state_after(events):
    """Node states and journal lines after a prefix of committed events."""
    nodes = {}
    edges_lit = set()
    for _seq, etype, node in events:
        if node is None:
            continue
        if etype == "NodeScheduled":
            nodes.setdefault(node, "scheduled")
        elif etype == "NodeStarted":
            nodes[node] = "running"
        elif etype == "NodeSucceeded":
            nodes[node] = "done"
        elif etype == "EdgeEmitted":
            edges_lit.add(node)
    return nodes, edges_lit


def journal_lines(events):
    lines = [("$ node tools/demo/capture.mjs", INK_SOFT),
             ("run research-diamond-bundle-001 · protected", INK_MUTED)]
    for seq, etype, node in events:
        text = f"{seq:>3}  {etype:<15} {node if node else '·'}"
        lines.append((text, EVENT_COLOR.get(etype, INK)))
    return lines


# ---------------------------------------------------------------------------
# Drawing helpers
# ---------------------------------------------------------------------------

def background():
    img = Image.new("RGB", (W, H), BG_TOP)
    px = img.load()
    for y in range(H):
        t = y / (H - 1)
        if t < 0.55:
            u = t / 0.55
            c = tuple(round(a + (b - a) * u) for a, b in zip(BG_TOP, BG_MID))
        else:
            u = (t - 0.55) / 0.45
            c = tuple(round(a + (b - a) * u) for a, b in zip(BG_MID, BG_BOT))
        for x in range(W):
            px[x, y] = c
    grid = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(grid)
    for x in range(0, W, 32):
        gd.line([(x, 0), (x, H)], fill=GRID + (13,), width=1)
    for y in range(0, H, 32):
        gd.line([(0, y), (W, y)], fill=GRID + (13,), width=1)
    img = Image.alpha_composite(img.convert("RGBA"), grid)
    return img


BG = background()


def glow_layer():
    return Image.new("RGBA", (W, H), (0, 0, 0, 0))


def arrow(d, p0, p1, color, width=2):
    d.line([p0, p1], fill=color, width=width)
    import math
    ang = math.atan2(p1[1] - p0[1], p1[0] - p0[0])
    size = 9
    left = (p1[0] - size * math.cos(ang - 0.42), p1[1] - size * math.sin(ang - 0.42))
    right = (p1[0] - size * math.cos(ang + 0.42), p1[1] - size * math.sin(ang + 0.42))
    d.polygon([p1, left, right], fill=color)


def edge_endpoints():
    eps = {}
    for key, cy in SOURCE_CY.items():
        eps[("scope", key)] = ((SCOPE_C[0] + SCOPE_R, SCOPE_C[1]),
                               (SOURCE_CX - SOURCE_W // 2 - 4, cy))
        eps[(key, "synthesize")] = ((SOURCE_CX + SOURCE_W // 2, cy),
                                    (SYNTH_C[0] - SYNTH_HW - 2, SYNTH_C[1]))
    return eps


EDGES = edge_endpoints()


def mix(c, other, t):
    return tuple(round(a + (b - a) * t) for a, b in zip(c, other))


def draw_scene(events, capture, caption=None, seen_full_concurrency=False):
    nodes, edges_lit = state_after(events)
    committed = len(events)

    # Pass 1: glow layer (soft halos under the crisp art)
    glow = glow_layer()
    gd = ImageDraw.Draw(glow)
    if nodes.get("scope") == "running":
        box = [SCOPE_C[0] - SCOPE_R, SCOPE_C[1] - SCOPE_R,
               SCOPE_C[0] + SCOPE_R, SCOPE_C[1] + SCOPE_R]
        gd.ellipse([b + o for b, o in zip(box, (-8, -8, 8, 8))], fill=SKY + (150,))
    for key, cy in SOURCE_CY.items():
        if nodes.get(key) == "running":
            box = [SOURCE_CX - SOURCE_W // 2, cy - SOURCE_H // 2,
                   SOURCE_CX + SOURCE_W // 2, cy + SOURCE_H // 2]
            gd.rounded_rectangle([b + o for b, o in zip(box, (-7, -7, 7, 7))],
                                 radius=18, fill=INDIGO + (150,))
    if nodes.get("synthesize") == "running":
        gpts = [(SYNTH_C[0], SYNTH_C[1] - SYNTH_HH - 8),
                (SYNTH_C[0] + SYNTH_HW + 8, SYNTH_C[1]),
                (SYNTH_C[0], SYNTH_C[1] + SYNTH_HH + 8),
                (SYNTH_C[0] - SYNTH_HW - 8, SYNTH_C[1])]
        gd.polygon(gpts, fill=TEAL + (150,))
    glow = glow.filter(ImageFilter.GaussianBlur(9))

    # Pass 2: crisp art on top of background + glow
    img = Image.alpha_composite(BG.copy(), glow)
    d = ImageDraw.Draw(img)

    # Header ---------------------------------------------------------------
    d.text((28, 20), "Graph Engineering", font=FONTS["title"], fill=INK)
    for i in range(300):
        t = i / 299
        d.line([(28 + i, 62), (28 + i, 65)], fill=mix(SKY, VIOLET, t))
    d.text((932, 30), "pattern: research-diamond", font=FONTS["mono15"],
           fill=INK_MUTED, anchor="ra")
    d.text((932, 52), "typed graph · fan-out · barrier · durable journal",
           font=FONTS["mono13"], fill=INK_MUTED, anchor="ra")

    # Edges ----------------------------------------------------------------
    for (src, dst), (p0, p1) in EDGES.items():
        lit = src in edges_lit
        color = EDGE if lit else mix(EDGE, BG_MID, 0.68)
        arrow(d, p0, p1, color, width=3 if lit else 2)

    # Nodes ----------------------------------------------------------------
    def node_style(node, accent, fill):
        st = nodes.get(node, "idle")
        if st == "idle":
            return mix(fill, BG_MID, 0.35), mix(accent, BG_MID, 0.55), False, False
        if st == "scheduled":
            return fill, mix(accent, INK, 0.0), False, False
        if st == "running":
            return mix(fill, accent, 0.18), accent, True, False
        return mix(fill, accent, 0.10), accent, False, True  # done

    # scope (circle)
    fill, stroke, glowing, done = node_style("scope", SKY, SCOPE_FILL)
    box = [SCOPE_C[0] - SCOPE_R, SCOPE_C[1] - SCOPE_R,
           SCOPE_C[0] + SCOPE_R, SCOPE_C[1] + SCOPE_R]
    d.ellipse(box, fill=fill, outline=stroke, width=3)
    d.text((SCOPE_C[0], SCOPE_C[1] - (8 if done else 0)), "scope",
           font=FONTS["mono16b"], fill=INK, anchor="mm")
    if done:
        d.text((SCOPE_C[0], SCOPE_C[1] + 13), "✓", font=FONTS["mono16b"],
               fill=TEAL, anchor="mm")

    # sources (rounded rects)
    for key, cy in SOURCE_CY.items():
        fill, stroke, glowing, done = node_style(key, INDIGO, SOURCE_FILL)
        box = [SOURCE_CX - SOURCE_W // 2, cy - SOURCE_H // 2,
               SOURCE_CX + SOURCE_W // 2, cy + SOURCE_H // 2]
        d.rounded_rectangle(box, radius=12, fill=fill, outline=stroke, width=3)
        label = key
        if done:
            d.text((SOURCE_CX - 12, cy), label, font=FONTS["mono16b"], fill=INK, anchor="mm")
            d.text((SOURCE_CX + SOURCE_W // 2 - 20, cy), "✓",
                   font=FONTS["mono16b"], fill=TEAL, anchor="mm")
        else:
            d.text((SOURCE_CX, cy), label, font=FONTS["mono16b"], fill=INK, anchor="mm")

    # synthesize (diamond barrier)
    fill, stroke, glowing, done = node_style("synthesize", TEAL, SYNTH_FILL)
    pts = [(SYNTH_C[0], SYNTH_C[1] - SYNTH_HH), (SYNTH_C[0] + SYNTH_HW, SYNTH_C[1]),
           (SYNTH_C[0], SYNTH_C[1] + SYNTH_HH), (SYNTH_C[0] - SYNTH_HW, SYNTH_C[1])]
    d.polygon(pts, fill=fill, outline=stroke, width=3)
    d.text((SYNTH_C[0], SYNTH_C[1] - (9 if done else 0)), "synthesize",
           font=FONTS["mono15"], fill=INK, anchor="mm")
    if done:
        d.text((SYNTH_C[0], SYNTH_C[1] + 12), "✓", font=FONTS["mono16b"],
               fill=TEAL, anchor="mm")
    barrier_note = "barrier: joins all 3" if nodes.get("synthesize") in (None, "scheduled") else None
    if barrier_note and committed > 0:
        d.text((SYNTH_C[0], SYNTH_C[1] + SYNTH_HH + 16), barrier_note,
               font=FONTS["mono13"], fill=INK_MUTED, anchor="mm")

    # Journal panel ---------------------------------------------------------
    jx0, jy0, jx1, jy1 = JOURNAL
    d.rounded_rectangle(JOURNAL, radius=12, fill=PANEL_FILL, outline=PANEL_EDGE, width=2)
    for i, c in enumerate(((248, 113, 113), (251, 191, 36), (74, 222, 128))):
        d.ellipse([jx0 + 16 + i * 20, jy0 + 12, jx0 + 27 + i * 20, jy0 + 23], fill=c)
    d.text((jx0 + 82, jy0 + 12), "protected journal — committed events",
           font=FONTS["mono13"], fill=INK_MUTED)
    d.line([(jx0 + 2, jy0 + 34), (jx1 - 2, jy0 + 34)], fill=PANEL_EDGE, width=1)

    lines = journal_lines(events)[-JOURNAL_MAX_LINES:]
    y = JOURNAL_TOP
    for text, color in lines:
        d.text((jx0 + 18, y), text, font=FONTS["mono15"], fill=color)
        y += JOURNAL_LINE_H

    # Bottom status bar ------------------------------------------------------
    running_sources = sum(1 for k in SOURCE_CY if nodes.get(k) == "running")
    d.text((28, 492), "parallel sources", font=FONTS["mono15"], fill=INK_MUTED)
    for i in range(3):
        cx = 190 + i * 26
        on = i < running_sources
        d.ellipse([cx, 494, cx + 13, 507], fill=TEAL if on else mix(TEAL, BG_BOT, 0.8),
                  outline=mix(TEAL, BG_BOT, 0.4), width=1)
    if running_sources == 3:
        note = "3/3 running concurrently"
    elif seen_full_concurrency:
        note = f"max observed concurrency: {capture['parallelRun']['maxObservedConcurrency']}"
    else:
        note = f"{running_sources}/3 running"
    d.text((286, 492), note, font=FONTS["mono15"],
           fill=TEAL if running_sources == 3 else INK_SOFT)
    d.text((932, 492), f"events committed: {committed}", font=FONTS["mono15"],
           fill=INK_MUTED, anchor="ra")

    if caption:
        d.text((W // 2, 528), caption, font=FONTS["mono13"], fill=INK_MUTED, anchor="mm")

    return img.convert("RGB")


def render_scene(events, capture, caption=None, seen_full=False):
    return draw_scene(events, capture, caption, seen_full)


# ---------------------------------------------------------------------------
# Closing card
# ---------------------------------------------------------------------------

def draw_closer(capture, stage):
    img = BG.copy()
    d = ImageDraw.Draw(img, "RGBA")
    d.rectangle([0, 0, W, H], fill=(4, 10, 25, 120))

    dr = capture["durableRun"]
    pr = capture["parallelRun"]
    rs = capture["reportSummary"]

    d.text((W // 2, 92), "from the committed journal", font=FONTS["mono16"],
           fill=INK_MUTED, anchor="mm")
    for i in range(240):
        t = i / 239
        d.line([(W // 2 - 120 + i, 112), (W // 2 - 120 + i, 114)], fill=mix(SKY, VIOLET, t))

    tiles = [
        (str(dr["committedEvents"]), "events committed", SKY),
        (str(pr["maxObservedConcurrency"]), "max observed concurrency", VIOLET),
        (str(dr["plaintextLeaksInJournal"]), "plaintext leaks in journal", TEAL),
    ]
    tw, th = 260, 104
    xs = [W // 2 - tw - tw // 2 - 24, W // 2 - tw // 2, W // 2 + tw // 2 + 24]
    for (num, label, accent), x in zip(tiles, xs):
        box = [x, 148, x + tw, 148 + th]
        d.rounded_rectangle(box, radius=14, fill=PANEL_FILL + (235,),
                            outline=mix(accent, BG_MID, 0.35), width=2)
        d.text((x + tw // 2, 148 + 40), num, font=FONTS["big"], fill=INK, anchor="mm")
        d.text((x + tw // 2, 148 + 82), label, font=FONTS["mono13"],
               fill=INK_MUTED, anchor="mm")

    if stage >= 1:
        line1 = (f"{dr['protectedPayloadBlobs']} protected payload blobs · "
                 f"{rs['acceptedClaims']} claims accepted · "
                 f"{rs['contradictions']} contradiction surfaced")
        line2 = (f"{rs['unsupportedClaims']} uncited claim rejected · "
                 f"total attempts {pr['totalAttempts']} · status {dr['status']}")
        d.text((W // 2, 296), line1, font=FONTS["mono16"], fill=INK_SOFT, anchor="mm")
        d.text((W // 2, 324), line2, font=FONTS["mono16"], fill=INK_SOFT, anchor="mm")
        d.text((W // 2, 360), f"graph hash {capture['graphHash'][:24]}…",
               font=FONTS["mono16"], fill=INK_MUTED, anchor="mm")

    if stage >= 2:
        d.line([(W // 2 - 280, 396), (W // 2 + 280, 396)], fill=PANEL_EDGE, width=1)
        d.text((W // 2, 424), REPO_LINE, font=FONTS["mono18b"], fill=INK, anchor="mm")
        d.text((W // 2, 458),
               "every frame rendered from a real run — tools/demo/capture.json",
               font=FONTS["mono13"], fill=INK_MUTED, anchor="mm")

    return img.convert("RGB")


# ---------------------------------------------------------------------------
# GIF assembly
# ---------------------------------------------------------------------------

def build_frames(capture):
    events = capture["events"]
    frames = []  # (image, duration_ms)

    frames.append((render_scene([], capture,
                                caption="replaying the committed journal of one durable run"),
                   int(INTRO_S * 1000)))

    seen_full = False
    for i in range(1, len(events) + 1):
        prefix = events[:i]
        nodes, _ = state_after(prefix)
        if sum(1 for k in SOURCE_CY if nodes.get(k) == "running") == 3:
            seen_full = True
        frames.append((render_scene(prefix, capture, seen_full=seen_full),
                       int(STEP_S * 1000)))

    frames.append((render_scene(events, capture, seen_full=True,
                                caption="run succeeded — journal is the source of truth"),
                   int(SETTLE_S * 1000)))

    frames.append((draw_closer(capture, 0), int(CLOSER_STEP_S * 1000)))
    frames.append((draw_closer(capture, 1), int(CLOSER_STEP_S * 1000)))
    frames.append((draw_closer(capture, 2), int(CLOSER_HOLD_S * 1000)))
    return frames


def save_gif(frames, out_path):
    # Shared adaptive palette built from a montage of representative frames.
    samples = [frames[0][0], frames[len(frames) // 3][0],
               frames[2 * len(frames) // 3][0], frames[-1][0]]
    montage = Image.new("RGB", (W, H * len(samples)))
    for i, s in enumerate(samples):
        montage.paste(s, (0, i * H))
    master = montage.quantize(colors=255, method=Image.Quantize.MEDIANCUT)

    quantized = [f.quantize(palette=master, dither=Image.Dither.NONE) for f, _ in frames]
    durations = [ms for _, ms in frames]
    quantized[0].save(
        out_path,
        save_all=True,
        append_images=quantized[1:],
        duration=durations,
        loop=0,
        optimize=True,
    )


# ---------------------------------------------------------------------------
# Animated SVG (SMIL) — same storyboard, same capture-driven timeline
# ---------------------------------------------------------------------------

def svg_document(capture):
    events = capture["events"]
    n = len(events)
    total = INTRO_S + n * STEP_S + SETTLE_S + 2 * CLOSER_STEP_S + CLOSER_HOLD_S
    t_event = lambda i: INTRO_S + i * STEP_S  # noqa: E731
    t_settle = INTRO_S + n * STEP_S
    t_closer = t_settle + SETTLE_S
    dr, pr, rs = capture["durableRun"], capture["parallelRun"], capture["reportSummary"]

    def kt(t):
        return max(0.0, min(0.999, t / total))

    def opacity_anim(windows, base=0.0):
        """Discrete opacity animation. windows = [(t_on, t_off_or_None), ...]"""
        values, keys = [], []
        if not any(kt(on) == 0.0 for on, _ in windows):
            values.append(str(base))
            keys.append(0.0)
        for on, off in windows:
            values.append("1")
            keys.append(kt(on))
            if off is not None:
                values.append(str(base))
                keys.append(kt(off))
        pairs = sorted(zip(keys, values), key=lambda p: p[0])
        keys = ";".join(f"{k:.5f}" for k, _ in pairs)
        vals = ";".join(v for _, v in pairs)
        return (f'<animate attributeName="opacity" dur="{total:.2f}s" '
                f'repeatCount="indefinite" calcMode="discrete" '
                f'values="{vals}" keyTimes="{keys}"/>')

    # Per-node event times
    started, succeeded, emitted = {}, {}, {}
    for i, (_s, etype, node) in enumerate(events):
        if node is None:
            continue
        t = t_event(i)
        if etype == "NodeStarted":
            started.setdefault(node, t)
        elif etype == "NodeSucceeded":
            succeeded[node] = t
        elif etype == "EdgeEmitted":
            emitted.setdefault(node, t)

    mono = "ui-monospace,'SF Mono',Menlo,Consolas,'DejaVu Sans Mono',monospace"
    sans = "Inter,ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif"

    def rgb(c):
        return f"rgb({c[0]},{c[1]},{c[2]})"

    parts = []
    parts.append(
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
        f'viewBox="0 0 {W} {H}" role="img" aria-labelledby="t d">'
        '<title id="t">Graph Engineering demo — research-diamond, replayed from a real committed journal</title>'
        '<desc id="d">A typed graph fans three sources out in parallel, joins them at a barrier, '
        'and commits every step to a protected journal. All frames derive from tools/demo/capture.json.</desc>')
    parts.append(
        '<defs>'
        '<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">'
        '<stop offset="0" stop-color="#081427"/><stop offset="0.55" stop-color="#102650"/>'
        '<stop offset="1" stop-color="#12213a"/></linearGradient>'
        '<linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">'
        '<stop offset="0" stop-color="#38bdf8"/><stop offset="1" stop-color="#a78bfa"/></linearGradient>'
        '<filter id="glow" x="-80%" y="-80%" width="260%" height="260%">'
        '<feGaussianBlur stdDeviation="7" result="b"/>'
        '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'
        '<pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">'
        '<path d="M 32 0 L 0 0 0 32" fill="none" stroke="#7dd3fc" stroke-opacity="0.055"/></pattern>'
        f'<clipPath id="jclip"><rect x="{JOURNAL[0] + 4}" y="{JOURNAL[1] + 36}" '
        f'width="{JOURNAL[2] - JOURNAL[0] - 8}" height="{JOURNAL[3] - JOURNAL[1] - 44}"/></clipPath>'
        '<marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" '
        'orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#66d9ef"/></marker>'
        '</defs>')
    parts.append(f'<rect width="{W}" height="{H}" fill="url(#bg)"/>')
    parts.append(f'<rect width="{W}" height="{H}" fill="url(#grid)"/>')

    # Header
    parts.append(
        f'<text x="28" y="46" font-family="{sans}" font-size="30" font-weight="750" '
        f'fill="{rgb(INK)}">Graph Engineering</text>'
        '<rect x="28" y="60" width="300" height="4" rx="2" fill="url(#accent)"/>'
        f'<text x="932" y="42" text-anchor="end" font-family="{mono}" font-size="15" '
        f'fill="{rgb(INK_MUTED)}">pattern: research-diamond</text>'
        f'<text x="932" y="62" text-anchor="end" font-family="{mono}" font-size="13" '
        f'fill="{rgb(INK_MUTED)}">typed graph · fan-out · barrier · durable journal</text>')

    # The whole animated scene dims for the closer.
    parts.append('<g>')
    parts.append(f'<animate attributeName="opacity" dur="{total:.2f}s" '
                 f'repeatCount="indefinite" calcMode="discrete" '
                 f'values="1;0.12" keyTimes="0;{kt(t_closer):.5f}"/>')

    # Edges (dim base + lit overlay)
    for (src, dst), (p0, p1) in EDGES.items():
        d_attr = f'M {p0[0]} {p0[1]} L {p1[0]} {p1[1]}'
        parts.append(f'<path d="{d_attr}" stroke="{rgb(EDGE)}" stroke-opacity="0.28" '
                     'stroke-width="2" fill="none" marker-end="url(#arr)"/>')
        if src in emitted:
            parts.append(f'<g opacity="0">{opacity_anim([(emitted[src], None)])}'
                         f'<path d="{d_attr}" stroke="{rgb(EDGE)}" stroke-width="3" '
                         'fill="none" marker-end="url(#arr)"/></g>')

    def node_variants(shape_idle, shape_running, shape_done, node):
        out = [shape_idle]
        if node in started:
            off = succeeded.get(node)
            out.append(f'<g opacity="0">{opacity_anim([(started[node], off)])}{shape_running}</g>')
        if node in succeeded:
            out.append(f'<g opacity="0">{opacity_anim([(succeeded[node], None)])}{shape_done}</g>')
        return "".join(out)

    # scope
    cx, cy = SCOPE_C
    label = (f'<text x="{cx}" y="{cy + 5}" text-anchor="middle" font-family="{mono}" '
             f'font-size="16" font-weight="700" fill="{rgb(INK)}">scope</text>')
    circ = lambda stroke, fill, extra="": (  # noqa: E731
        f'<circle cx="{cx}" cy="{cy}" r="{SCOPE_R}" fill="{fill}" stroke="{stroke}" '
        f'stroke-width="3" {extra}/>')
    parts.append(node_variants(
        circ(rgb(mix(SKY, BG_MID, 0.55)), rgb(mix(SCOPE_FILL, BG_MID, 0.35))) + label,
        circ(rgb(SKY), rgb(mix(SCOPE_FILL, SKY, 0.18)), 'filter="url(#glow)"') + label,
        circ(rgb(SKY), rgb(mix(SCOPE_FILL, SKY, 0.10)))
        + f'<text x="{cx}" y="{cy - 1}" text-anchor="middle" font-family="{mono}" font-size="16" '
          f'font-weight="700" fill="{rgb(INK)}">scope</text>'
          f'<text x="{cx}" y="{cy + 19}" text-anchor="middle" font-family="{mono}" font-size="15" '
          f'font-weight="700" fill="{rgb(TEAL)}">✓</text>',
        "scope"))

    # sources
    for key, scy in SOURCE_CY.items():
        x0 = SOURCE_CX - SOURCE_W // 2
        y0 = scy - SOURCE_H // 2
        rect = lambda stroke, fill, extra="": (  # noqa: E731
            f'<rect x="{x0}" y="{y0}" width="{SOURCE_W}" height="{SOURCE_H}" rx="12" '
            f'fill="{fill}" stroke="{stroke}" stroke-width="3" {extra}/>')
        lbl = (f'<text x="{SOURCE_CX}" y="{scy + 5}" text-anchor="middle" font-family="{mono}" '
               f'font-size="16" font-weight="700" fill="{rgb(INK)}">{key}</text>')
        lbl_done = (f'<text x="{SOURCE_CX - 12}" y="{scy + 5}" text-anchor="middle" '
                    f'font-family="{mono}" font-size="16" font-weight="700" fill="{rgb(INK)}">{key}</text>'
                    f'<text x="{x0 + SOURCE_W - 20}" y="{scy + 6}" text-anchor="middle" '
                    f'font-family="{mono}" font-size="15" font-weight="700" fill="{rgb(TEAL)}">✓</text>')
        parts.append(node_variants(
            rect(rgb(mix(INDIGO, BG_MID, 0.55)), rgb(mix(SOURCE_FILL, BG_MID, 0.35))) + lbl,
            rect(rgb(INDIGO), rgb(mix(SOURCE_FILL, INDIGO, 0.18)), 'filter="url(#glow)"') + lbl,
            rect(rgb(INDIGO), rgb(mix(SOURCE_FILL, INDIGO, 0.10))) + lbl_done,
            key))

    # synthesize
    sx, sy = SYNTH_C
    pts = f'{sx},{sy - SYNTH_HH} {sx + SYNTH_HW},{sy} {sx},{sy + SYNTH_HH} {sx - SYNTH_HW},{sy}'
    poly = lambda stroke, fill, extra="": (  # noqa: E731
        f'<polygon points="{pts}" fill="{fill}" stroke="{stroke}" stroke-width="3" {extra}/>')
    slbl = (f'<text x="{sx}" y="{sy + 5}" text-anchor="middle" font-family="{mono}" '
            f'font-size="14" font-weight="700" fill="{rgb(INK)}">synthesize</text>')
    slbl_done = (f'<text x="{sx}" y="{sy - 3}" text-anchor="middle" font-family="{mono}" '
                 f'font-size="14" font-weight="700" fill="{rgb(INK)}">synthesize</text>'
                 f'<text x="{sx}" y="{sy + 18}" text-anchor="middle" font-family="{mono}" '
                 f'font-size="15" font-weight="700" fill="{rgb(TEAL)}">✓</text>')
    parts.append(node_variants(
        poly(rgb(mix(TEAL, BG_MID, 0.55)), rgb(mix(SYNTH_FILL, BG_MID, 0.35))) + slbl,
        poly(rgb(TEAL), rgb(mix(SYNTH_FILL, TEAL, 0.18)), 'filter="url(#glow)"') + slbl,
        poly(rgb(TEAL), rgb(mix(SYNTH_FILL, TEAL, 0.10))) + slbl_done,
        "synthesize"))
    parts.append(f'<text x="{sx}" y="{sy + SYNTH_HH + 20}" text-anchor="middle" '
                 f'font-family="{mono}" font-size="13" fill="{rgb(INK_MUTED)}">barrier: joins all 3</text>')

    # Journal panel
    jx0, jy0, jx1, jy1 = JOURNAL
    parts.append(f'<rect x="{jx0}" y="{jy0}" width="{jx1 - jx0}" height="{jy1 - jy0}" rx="12" '
                 f'fill="{rgb(PANEL_FILL)}" stroke="{rgb(PANEL_EDGE)}" stroke-width="2"/>')
    for i, c in enumerate(("#f87171", "#fbbf24", "#4ade80")):
        parts.append(f'<circle cx="{jx0 + 22 + i * 20}" cy="{jy0 + 18}" r="5.5" fill="{c}"/>')
    parts.append(f'<text x="{jx0 + 82}" y="{jy0 + 23}" font-family="{mono}" font-size="13" '
                 f'fill="{rgb(INK_MUTED)}">protected journal — committed events</text>')
    parts.append(f'<line x1="{jx0 + 2}" y1="{jy0 + 34}" x2="{jx1 - 2}" y2="{jy0 + 34}" '
                 f'stroke="{rgb(PANEL_EDGE)}"/>')

    # Journal lines: fixed positions inside a scrolling group.
    all_lines = journal_lines(events)
    line_count = len(all_lines)
    # scroll offset after line k lines are visible
    scroll_values, scroll_keys = ["0"], [0.0]
    for i in range(line_count):
        visible = i + 1
        if visible > JOURNAL_MAX_LINES:
            shift = (visible - JOURNAL_MAX_LINES) * JOURNAL_LINE_H
            t_line = 0.0 if i < 2 else t_event(i - 2)
            scroll_values.append(f"0 -{shift}")
            scroll_keys.append(kt(t_line))
    scroll_anim = (f'<animateTransform attributeName="transform" type="translate" '
                   f'dur="{total:.2f}s" repeatCount="indefinite" calcMode="discrete" '
                   f'values="{";".join(scroll_values)}" '
                   f'keyTimes="{";".join(f"{k:.5f}" for k in scroll_keys)}"/>')
    line_parts = []
    for i, (text, color) in enumerate(all_lines):
        y = JOURNAL_TOP + 15 + i * JOURNAL_LINE_H
        esc = text.replace("&", "&amp;").replace("<", "&lt;")
        if i < 2:
            vis = ""
        else:
            vis = opacity_anim([(t_event(i - 2), None)])
        wrap_open = f'<g opacity="0">{vis}' if vis else "<g>"
        line_parts.append(f'{wrap_open}<text x="{jx0 + 18}" y="{y}" font-family="{mono}" '
                          f'font-size="15" fill="{rgb(color)}">{esc}</text></g>')
    parts.append(f'<g clip-path="url(#jclip)"><g>{scroll_anim}{"".join(line_parts)}</g></g>')

    # Bottom bar: concurrency dots + captions
    parts.append(f'<text x="28" y="505" font-family="{mono}" font-size="15" '
                 f'fill="{rgb(INK_MUTED)}">parallel sources</text>')
    order = ["source-code", "source-docs", "source-web"]
    for i, key in enumerate(order):
        cxd = 196 + i * 26
        parts.append(f'<circle cx="{cxd}" cy="500" r="6.5" fill="{rgb(mix(TEAL, BG_BOT, 0.8))}" '
                     f'stroke="{rgb(mix(TEAL, BG_BOT, 0.4))}"/>')
        if key in started:
            parts.append(f'<g opacity="0">{opacity_anim([(started[key], succeeded.get(key))])}'
                         f'<circle cx="{cxd}" cy="500" r="6.5" fill="{rgb(TEAL)}"/></g>')
    t_all3 = max(started[k] for k in order)
    t_first_done = min(succeeded[k] for k in order)
    parts.append(f'<g opacity="0">{opacity_anim([(t_all3, t_first_done)])}'
                 f'<text x="286" y="505" font-family="{mono}" font-size="15" font-weight="700" '
                 f'fill="{rgb(TEAL)}">3/3 running concurrently</text></g>')
    parts.append(f'<g opacity="0">{opacity_anim([(t_first_done, None)])}'
                 f'<text x="286" y="505" font-family="{mono}" font-size="15" '
                 f'fill="{rgb(INK_SOFT)}">max observed concurrency: {pr["maxObservedConcurrency"]}</text></g>')
    # events-committed counter
    counter = []
    for i in range(n + 1):
        on = 0.0 if i == 0 else t_event(i - 1)
        off = t_event(i) if i < n else None
        counter.append(f'<g opacity="0">{opacity_anim([(on, off)])}'
                       f'<text x="932" y="505" text-anchor="end" font-family="{mono}" '
                       f'font-size="15" fill="{rgb(INK_MUTED)}">events committed: {i}</text></g>')
    parts.append("".join(counter))
    parts.append('</g>')  # end scene group

    # Closer
    closer = []
    closer.append(f'<g opacity="0">{opacity_anim([(t_closer, None)])}')
    closer.append(f'<rect width="{W}" height="{H}" fill="#040a19" opacity="0.55"/>')
    closer.append(f'<text x="{W // 2}" y="97" text-anchor="middle" font-family="{mono}" '
                  f'font-size="16" fill="{rgb(INK_MUTED)}">from the committed journal</text>')
    closer.append(f'<rect x="{W // 2 - 120}" y="110" width="240" height="3" rx="1.5" fill="url(#accent)"/>')
    tiles = [
        (str(dr["committedEvents"]), "events committed", SKY),
        (str(pr["maxObservedConcurrency"]), "max observed concurrency", VIOLET),
        (str(dr["plaintextLeaksInJournal"]), "plaintext leaks in journal", TEAL),
    ]
    tw, th = 260, 104
    xs = [W // 2 - tw - tw // 2 - 24, W // 2 - tw // 2, W // 2 + tw // 2 + 24]
    for (num, lab, accent), x in zip(tiles, xs):
        closer.append(f'<rect x="{x}" y="148" width="{tw}" height="{th}" rx="14" '
                      f'fill="{rgb(PANEL_FILL)}" fill-opacity="0.92" '
                      f'stroke="{rgb(mix(accent, BG_MID, 0.35))}" stroke-width="2"/>')
        closer.append(f'<text x="{x + tw // 2}" y="201" text-anchor="middle" font-family="{sans}" '
                      f'font-size="40" font-weight="750" fill="{rgb(INK)}">{num}</text>')
        closer.append(f'<text x="{x + tw // 2}" y="235" text-anchor="middle" font-family="{mono}" '
                      f'font-size="13" fill="{rgb(INK_MUTED)}">{lab}</text>')
    closer.append(f'<g opacity="0">{opacity_anim([(t_closer + CLOSER_STEP_S, None)])}')
    line1 = (f'{dr["protectedPayloadBlobs"]} protected payload blobs · '
             f'{rs["acceptedClaims"]} claims accepted · {rs["contradictions"]} contradiction surfaced')
    line2 = (f'{rs["unsupportedClaims"]} uncited claim rejected · total attempts {pr["totalAttempts"]} '
             f'· status {dr["status"]}')
    closer.append(f'<text x="{W // 2}" y="301" text-anchor="middle" font-family="{mono}" '
                  f'font-size="16" fill="{rgb(INK_SOFT)}">{line1}</text>')
    closer.append(f'<text x="{W // 2}" y="329" text-anchor="middle" font-family="{mono}" '
                  f'font-size="16" fill="{rgb(INK_SOFT)}">{line2}</text>')
    closer.append(f'<text x="{W // 2}" y="365" text-anchor="middle" font-family="{mono}" '
                  f'font-size="16" fill="{rgb(INK_MUTED)}">graph hash {capture["graphHash"][:24]}…</text>')
    closer.append('</g>')
    closer.append(f'<g opacity="0">{opacity_anim([(t_closer + 2 * CLOSER_STEP_S, None)])}')
    closer.append(f'<line x1="{W // 2 - 280}" y1="396" x2="{W // 2 + 280}" y2="396" '
                  f'stroke="{rgb(PANEL_EDGE)}"/>')
    closer.append(f'<text x="{W // 2}" y="430" text-anchor="middle" font-family="{mono}" '
                  f'font-size="18" font-weight="700" fill="{rgb(INK)}">{REPO_LINE}</text>')
    closer.append(f'<text x="{W // 2}" y="462" text-anchor="middle" font-family="{mono}" '
                  f'font-size="13" fill="{rgb(INK_MUTED)}">every frame rendered from a real run — '
                  'tools/demo/capture.json</text>')
    closer.append('</g></g>')
    parts.append("".join(closer))
    parts.append('</svg>')
    return "".join(parts)


# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out-dir", default=str(REPO / "docs" / "assets"))
    ap.add_argument("--previews", default=None,
                    help="also dump representative PNG frames to this directory")
    args = ap.parse_args()

    capture = json.loads((ROOT / "capture.json").read_text())
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    frames = build_frames(capture)
    gif_path = out_dir / "demo.gif"
    save_gif(frames, gif_path)

    svg_path = out_dir / "demo.svg"
    svg_path.write_text(svg_document(capture) + "\n")

    total_ms = sum(ms for _, ms in frames)
    print(f"{gif_path}: {len(frames)} frames, {total_ms / 1000:.1f}s loop, "
          f"{gif_path.stat().st_size / 1024:.0f} KiB")
    print(f"{svg_path}: {svg_path.stat().st_size / 1024:.0f} KiB")

    if args.previews:
        pv = Path(args.previews)
        pv.mkdir(parents=True, exist_ok=True)
        picks = {0: "intro", 14: "concurrent", len(frames) - 4: "complete",
                 len(frames) - 1: "closer"}
        for idx, name in picks.items():
            frames[idx][0].save(pv / f"frame-{idx:02d}-{name}.png")
        print(f"previews -> {pv}")


if __name__ == "__main__":
    main()
