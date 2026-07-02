#!/usr/bin/env python3
"""
Generate SVG assets of Beamer+ UI elements (buttons, toolbars, icons) for use
in the Beamer+ paper — either inline in text or as standalone figures.

Icon path data and design tokens are lifted directly from the live app
(templates/index.html, static/css/tokens.css, static/js/annotations/*) so the
figures stay faithful to the real UI.

Outputs (under paper/figures/):
    icons/    bare glyphs (24x24, no chrome)     — for tight inline use
    buttons/  glyph + button chrome (border/bg)  — looks like a real button
    toolbars/ composite multi-button bars        — for figures
    index.html  contact sheet previewing everything

Run:  python paper/figures/generate_ui_svgs.py
"""

import os
import math

HERE = os.path.dirname(os.path.abspath(__file__))

# ----------------------------------------------------------------------------
# Design tokens (hex approximations of the app's oklch tokens, so the SVGs
# render identically in every toolchain incl. Inkscape / rsvg / LaTeX).
# ----------------------------------------------------------------------------
PAPER         = "#FCFCFB"   # --surface-paper
INK           = "#2C2F36"   # --ink-1 (default glyph stroke)
INK_2         = "#55585F"   # --ink-2 (secondary text)
INK_3         = "#7E8189"   # --ink-3 (tertiary)
INK_4         = "#AEB0B5"   # --ink-4 (hairline content)
BORDER        = "#CFD0D3"   # default button border
RAIL_BG       = "#FBFBFA"   # glass rail background (opaque approximation)
ACCENT        = "#6B6D71"   # --accent (selected fill)
ACCENT_STRONG = "#4A4C50"   # --accent-strong (selected border)
ON_ACCENT     = "#FCFCFB"   # --ink-on-accent (glyph on selected)
HAIRLINE      = "#D6D7DA"   # rail / divider hairline

# Pen-slot colors (static/js/annotations/pen-slots.js DEFAULT_PROFILES)
PEN_PROFILES = [
    ("pen-1", "draw",      "#333333"),
    ("pen-2", "draw",      "#e74c3c"),
    ("pen-3", "highlight", "#f1c40f"),
    ("pen-4", "highlight", "#2ecc71"),
    ("pen-5", "draw",      "#3498db"),
]

# ----------------------------------------------------------------------------
# Icon inner markup. All share viewBox 0 0 24 24, fill=none, stroke=currentColor,
# stroke-width 2, round caps/joins (matches the app's inline <svg> children).
# ----------------------------------------------------------------------------
ICONS = {
    # slide navigator
    "split-toggle":   '<rect x="2" y="3" width="20" height="18" rx="2"/><line x1="12" y1="3" x2="12" y2="21"/>',
    "add-blank":      '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>',
    "delete-blank":   '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    "bookmark":       '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',

    # top-right / edit
    "edit-mode":      '<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>',
    "upload":         '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
    "save":           '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',

    # annotation tools
    "hand":           '<path d="M18 11V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2 2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2v8"/><path d="M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
    "spotlight":      '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    "pen":            '<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>',
    "highlight":      '<path d="m9 11-6 6v3h3l6-6"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
    "eraser":         '<path d="M7 21h10"/><path d="m5 11 9-9 6 6-9 9H5z"/>',
    "undo":           '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
    "redo":           '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
    "clear":          '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>',

    # editor add-media row
    "add-view":       '<rect x="1" y="3" width="8" height="18" rx="1.5"/><rect x="15" y="3" width="8" height="18" rx="1.5"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="9" y1="12" x2="15" y2="12"/>',
    "add-video":      '<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>',
    "add-audio":      '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    "add-model":      '<path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
    "add-widget":     '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/>',

    # bottom controls
    "tour":           '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
    "help":           '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    "settings":       '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
}

# Human-readable labels (used in the contact sheet)
LABELS = {
    "split-toggle": "Split view",       "add-blank": "Insert blank slide",
    "delete-blank": "Delete blank slide","bookmark": "Bookmark slide",
    "edit-mode": "Edit mode",            "upload": "Upload presentation",
    "save": "Save / download",           "hand": "Hand / pointer",
    "spotlight": "Spotlight",            "pen": "Pen",
    "highlight": "Highlighter",          "eraser": "Eraser",
    "undo": "Undo",                      "redo": "Redo",
    "clear": "Clear all",                "add-view": "Insert split view",
    "add-video": "Add video",            "add-audio": "Add audio",
    "add-model": "Add 3D model",         "add-widget": "Add widget",
    "tour": "Take a tour",               "help": "Help",
    "settings": "Settings",
}

# ----------------------------------------------------------------------------
# Builders
# ----------------------------------------------------------------------------
def esc(s):
    """Escape text for safe inclusion in SVG/XML content."""
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def glyph_group(name, stroke, x=0, y=0, scale=1.0):
    """A 24x24 icon as a positioned/scaled <g>."""
    return (
        f'<g transform="translate({x},{y}) scale({scale})" '
        f'fill="none" stroke="{stroke}" stroke-width="2" '
        f'stroke-linecap="round" stroke-linejoin="round">{ICONS[name]}</g>'
    )


def bare_icon(name, stroke=INK):
    """24x24 glyph only, no chrome."""
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" '
        f'width="24" height="24" fill="none" stroke="{stroke}" '
        f'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
        f'{ICONS[name]}</svg>'
    )


def button(name, stroke=INK, selected=False, box=36, icon=20):
    """Glyph wrapped in button chrome (rounded rect, border, fill)."""
    bg  = ACCENT if selected else PAPER
    bd  = ACCENT_STRONG if selected else BORDER
    gs  = stroke
    if selected and stroke == INK:        # default glyph turns light on accent
        gs = ON_ACCENT
    pad = (box - icon) / 2
    scale = icon / 24
    inset = 1.0
    r = 9
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {box} {box}" '
        f'width="{box}" height="{box}">'
        f'<rect x="{inset}" y="{inset}" width="{box-2*inset}" height="{box-2*inset}" '
        f'rx="{r}" ry="{r}" fill="{bg}" stroke="{bd}" stroke-width="1.5"/>'
        f'{glyph_group(name, gs, pad, pad, scale)}'
        f'</svg>'
    )


def toolbar(items, vertical=True, box=40, icon=20, gap=6, pad=8,
            dividers=None, bg=RAIL_BG, border=HAIRLINE, radius=12):
    """
    Composite bar of buttons.
    items: list of dicts {name, stroke?, selected?}
    dividers: set of indices BEFORE which to draw a separator line.
    """
    dividers = dividers or set()
    n = len(items)
    # extra space for divider gaps
    div_gap = gap  # extra space added where a divider sits
    span_main = pad + n * box + (n - 1) * gap + len(dividers) * (div_gap + 1) + pad
    span_cross = pad + box + pad

    w, h = (span_cross, span_main) if vertical else (span_main, span_cross)
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.0f} {h:.0f}" '
        f'width="{w:.0f}" height="{h:.0f}">',
        f'<rect x="0.75" y="0.75" width="{w-1.5:.1f}" height="{h-1.5:.1f}" '
        f'rx="{radius}" ry="{radius}" fill="{bg}" stroke="{border}" stroke-width="1.5"/>',
    ]
    cur = pad
    for i, it in enumerate(items):
        if i in dividers:
            # separator across the cross axis
            if vertical:
                ly = cur + div_gap / 2
                parts.append(f'<line x1="{pad}" y1="{ly:.1f}" x2="{w-pad:.1f}" y2="{ly:.1f}" '
                             f'stroke="{border}" stroke-width="1"/>')
            else:
                lx = cur + div_gap / 2
                parts.append(f'<line x1="{lx:.1f}" y1="{pad}" x2="{lx:.1f}" y2="{h-pad:.1f}" '
                             f'stroke="{border}" stroke-width="1"/>')
            cur += div_gap + 1

        bx = pad if vertical else cur
        by = cur if vertical else pad

        sel = it.get("selected", False)
        stroke = it.get("stroke", INK)
        gs = stroke
        bdr = ACCENT_STRONG if sel else "transparent"
        bgf = ACCENT if sel else "transparent"
        if sel and stroke == INK:
            gs = ON_ACCENT
        scale = icon / 24
        ipad = (box - icon) / 2
        parts.append(
            f'<g transform="translate({bx:.1f},{by:.1f})">'
            f'<rect x="0" y="0" width="{box}" height="{box}" rx="8" ry="8" '
            f'fill="{bgf}" stroke="{bdr}" stroke-width="1.5"/>'
            f'{glyph_group(it["name"], gs, ipad, ipad, scale)}'
            f'</g>'
        )
        cur += box + gap
    parts.append('</svg>')
    return "".join(parts)


# ----------------------------------------------------------------------------
# Composite "Figure 1" — annotated overview of the whole interface
# ----------------------------------------------------------------------------
# Extra surface colors (hex approximations of the measured app tokens)
STAGE  = "#EDECE7"   # --surface-stage  oklch(0.96) — slide backdrop
CREAM  = "#F3F2ED"   # --surface-cream  oklch(0.97) — navigator
CREAM2 = "#E9E8E3"   # title bar / nested surfaces
SLIDE  = "#FFFFFF"
MARKER = "#3A3D42"   # callout disc

# Live geometry, measured from the running app at a 1280x720 viewport
# (preview_eval on getBoundingClientRect). The composite figures are drawn
# by scaling these real rects, so proportions match the actual UI.
APP_W, APP_H = 1280, 720


def _fbtn(name, x, y, w, h, sel=False, stroke=INK, chrome=True, rscale=1.0):
    """A figure button occupying (x, y, w, h); glyph centered.
    Icon-to-button ratio matches the live app (18px glyph in a 40px hit area)."""
    icon = min(w, h) * 0.45
    sc = (icon / 24) * rscale
    gw = 24 * sc
    gx = x + (w - gw) / 2
    gy = y + (h - gw) / 2
    bg  = ACCENT if sel else (PAPER if chrome else "transparent")
    bd  = ACCENT_STRONG if sel else (BORDER if chrome else "transparent")
    gs  = ON_ACCENT if (sel and stroke == INK) else stroke
    rx = min(8 * rscale, h / 2)
    rect = (f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" '
            f'rx="{rx:.1f}" ry="{rx:.1f}" fill="{bg}" stroke="{bd}" stroke-width="1"/>')
    return rect + glyph_group(name, gs, gx, gy, sc)


def _marker(n, x, y, r=12):
    fs = r if len(str(n)) == 1 else r * 0.78    # shrink for 2-digit numbers
    return (f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r}" fill="{MARKER}" '
            f'stroke="#FFFFFF" stroke-width="2"/>'
            f'<text x="{x:.1f}" y="{y+r*0.36:.1f}" text-anchor="middle" '
            f'font-family="sans-serif" font-size="{fs:.1f}" font-weight="700" '
            f'fill="#FFFFFF">{n}</text>')


def _rrect_path(x, y, w, h, r, corners="tl,tr,br,bl"):
    """Path data for a rect with only the named corners rounded. Used instead of
    a clipPath so the window's rounded look survives every SVG->PDF renderer
    (svglib's clipPath output is mishandled by some PDF viewers)."""
    rtl = r if "tl" in corners else 0
    rtr = r if "tr" in corners else 0
    rbr = r if "br" in corners else 0
    rbl = r if "bl" in corners else 0
    d = [f"M {x+rtl:.2f} {y:.2f}", f"H {x+w-rtr:.2f}"]
    if rtr: d.append(f"A {rtr:.2f} {rtr:.2f} 0 0 1 {x+w:.2f} {y+rtr:.2f}")
    d.append(f"V {y+h-rbr:.2f}")
    if rbr: d.append(f"A {rbr:.2f} {rbr:.2f} 0 0 1 {x+w-rbr:.2f} {y+h:.2f}")
    d.append(f"H {x+rbl:.2f}")
    if rbl: d.append(f"A {rbl:.2f} {rbl:.2f} 0 0 1 {x:.2f} {y+h-rbl:.2f}")
    d.append(f"V {y+rtl:.2f}")
    if rtl: d.append(f"A {rtl:.2f} {rtl:.2f} 0 0 1 {x+rtl:.2f} {y:.2f}")
    d.append("Z")
    return " ".join(d)


def _window_frame(p, win_x, win_y, win_w, win_h, bar_h, clip_id=None):
    """Draw the window chrome (NO clip — corners are handled by drawing the
    stage/nav as rounded-bottom paths, then a border on top in _window_finish).
    Returns (cx1, cy0, cy1)."""
    cy0 = win_y + bar_h
    cx1, cy1 = win_x + win_w, win_y + win_h
    # base fill (covered by content; gives the rounded top its paper colour)
    p.append(f'<path d="{_rrect_path(win_x, win_y, win_w, win_h, 14)}" '
             f'fill="{PAPER}"/>')
    # title bar (rounded top corners only)
    p.append(f'<path d="{_rrect_path(win_x, win_y, win_w, bar_h, 14, "tl,tr")}" '
             f'fill="{CREAM2}"/>')
    ctrl_y = win_y + bar_h/2
    p.append(f'<text x="{win_x+16}" y="{ctrl_y+5}" font-size="14" font-weight="600" '
             f'fill="{INK}" font-family="Georgia, serif">Beamer+</text>')
    # OS-agnostic window controls (minimize / maximize / close), muted gray
    cc = win_x + win_w - 18
    cm, cn = cc - 22, cc - 44
    p.append(f'<line x1="{cn-5}" y1="{ctrl_y}" x2="{cn+5}" y2="{ctrl_y}" '
             f'stroke="{INK_3}" stroke-width="1.5" stroke-linecap="round"/>')
    p.append(f'<rect x="{cm-5}" y="{ctrl_y-5}" width="10" height="10" rx="1.5" '
             f'fill="none" stroke="{INK_3}" stroke-width="1.5"/>')
    p.append(f'<line x1="{cc-5}" y1="{ctrl_y-5}" x2="{cc+5}" y2="{ctrl_y+5}" '
             f'stroke="{INK_3}" stroke-width="1.5" stroke-linecap="round"/>')
    p.append(f'<line x1="{cc-5}" y1="{ctrl_y+5}" x2="{cc+5}" y2="{ctrl_y-5}" '
             f'stroke="{INK_3}" stroke-width="1.5" stroke-linecap="round"/>')
    p.append(f'<line x1="{win_x}" y1="{cy0}" x2="{cx1}" y2="{cy0}" '
             f'stroke="{BORDER}" stroke-width="1"/>')
    return cx1, cy0, cy1


def _window_finish(p, win_x, win_y, win_w, win_h):
    """Draw the window's rounded outline on top of the content."""
    p.append(f'<path d="{_rrect_path(win_x, win_y, win_w, win_h, 14)}" '
             f'fill="none" stroke="{BORDER}" stroke-width="1.5"/>')


def _legend(p, entries, x0, y0, col_w, rows_per_col=4):
    for idx, (n, title, desc) in enumerate(entries):
        col = idx // rows_per_col
        row = idx % rows_per_col
        lx = x0 + col * col_w
        ly = y0 + row * 28
        p.append(f'<circle cx="{lx+10}" cy="{ly-4}" r="10" fill="{MARKER}"/>')
        p.append(f'<text x="{lx+10}" y="{ly}" text-anchor="middle" font-size="11" '
                 f'font-weight="700" fill="#FFFFFF">{n}</text>')
        p.append(f'<text x="{lx+28}" y="{ly}" font-size="14" fill="{INK}">'
                 f'<tspan font-weight="600">{esc(title)}</tspan>'
                 f'<tspan fill="{INK_2}"> — {esc(desc)}</tspan></text>')


def _slide_content(p, sx, sy, sw, sh, s, title="Recursion", variant=0):
    """Draw a sample slide's content scaled by s. ``variant`` selects between
    two visibly distinct layouts so side-by-side slides don't look identical.
    Coordinates inside are expressed in real px then scaled."""
    def X(v): return sx + v * s
    def Y(v): return sy + v * s
    def L(v): return v * s
    # title (variant 0 gets a highlighter swipe)
    if variant == 0:
        # highlighter swipe sized to roughly the rendered title width
        p.append(f'<rect x="{X(34)}" y="{Y(30)}" width="{L(len(title)*10.5):.1f}" '
                 f'height="{L(34)}" fill="#f1c40f" opacity="0.4"/>')
    p.append(f'<text x="{X(36)}" y="{Y(58)}" font-size="{L(30):.1f}" font-weight="600" '
             f'fill="{INK}" font-family="Georgia, serif">{esc(title)}</text>')
    p.append(f'<line x1="{X(36)}" y1="{Y(78)}" x2="{X(sw/s-36):.1f}" y2="{Y(78)}" '
             f'stroke="{BORDER}" stroke-width="1.5"/>')

    if variant == 0:
        # bullets + embedded video + interactive widget + red pen scribble
        for i, w in enumerate([300, 360, 250]):
            yy = 110 + i * 30
            p.append(f'<circle cx="{X(48)}" cy="{Y(yy-5)}" r="{L(4):.1f}" fill="{INK_2}"/>')
            p.append(f'<line x1="{X(64)}" y1="{Y(yy-5)}" x2="{X(64+w)}" y2="{Y(yy-5)}" '
                     f'stroke="{INK_3}" stroke-width="{L(4):.1f}" stroke-linecap="round"/>')
        p.append(f'<rect x="{X(40)}" y="{Y(230)}" width="{L(250)}" height="{L(160)}" '
                 f'rx="6" fill="{CREAM2}" stroke="{BORDER}" stroke-width="1"/>')
        pcx, pcy = X(165), Y(310)
        p.append(f'<circle cx="{pcx}" cy="{pcy}" r="{L(26):.1f}" fill="{ACCENT}" '
                 f'opacity="0.92"/>')
        d = L(11)
        p.append(f'<path d="M{pcx-d*0.5:.1f} {pcy-d:.1f} L{pcx+d:.1f} {pcy:.1f} '
                 f'L{pcx-d*0.5:.1f} {pcy+d:.1f} Z" fill="#FFFFFF"/>')
        p.append(f'<rect x="{X(310)}" y="{Y(230)}" width="{L(240)}" height="{L(160)}" '
                 f'rx="6" fill="{CREAM2}" stroke="{BORDER}" stroke-width="1"/>')
        # interactive-widget glyph, sized to roughly match the video play button
        wsc = (46 / 24) * s
        gsz = 24 * wsc
        p.append(glyph_group("add-widget", ACCENT,
                             X(430) - gsz/2, Y(310) - gsz/2, wsc))
        q = L(18)
        p.append(f'<path d="M{X(330)} {Y(108)} q {q} {-q} {2*q} 0 t {2*q} 0 t {2*q} 0" '
                 f'fill="none" stroke="#e74c3c" stroke-width="{L(3):.1f}" '
                 f'stroke-linecap="round"/>')
    else:
        # fewer bullets + a wide chart/plot widget + green ellipse annotation
        for i, w in enumerate([340, 250]):
            yy = 110 + i * 30
            p.append(f'<circle cx="{X(48)}" cy="{Y(yy-5)}" r="{L(4):.1f}" fill="{INK_2}"/>')
            p.append(f'<line x1="{X(64)}" y1="{Y(yy-5)}" x2="{X(64+w)}" y2="{Y(yy-5)}" '
                     f'stroke="{INK_3}" stroke-width="{L(4):.1f}" stroke-linecap="round"/>')
        # chart widget
        cxl, cyt, cw_, ch_ = 40, 190, 510, 205
        p.append(f'<rect x="{X(cxl)}" y="{Y(cyt)}" width="{L(cw_)}" height="{L(ch_)}" '
                 f'rx="6" fill="{CREAM2}" stroke="{BORDER}" stroke-width="1"/>')
        ax0, ay0, ax1 = cxl+34, cyt+ch_-30, cxl+cw_-24   # axes
        p.append(f'<line x1="{X(ax0)}" y1="{Y(cyt+20)}" x2="{X(ax0)}" y2="{Y(ay0)}" '
                 f'stroke="{INK_3}" stroke-width="1.5"/>')
        p.append(f'<line x1="{X(ax0)}" y1="{Y(ay0)}" x2="{X(ax1)}" y2="{Y(ay0)}" '
                 f'stroke="{INK_3}" stroke-width="1.5"/>')
        # a monotonically increasing growth curve (suits "Big-O")
        pts = []
        for k in range(0, 41):
            t = k / 40
            vx = ax0 + t * (ax1 - ax0)
            vy = ay0 - (t ** 1.8) * (ch_ - 55)
            pts.append(f'{X(vx):.1f} {Y(vy):.1f}')
        p.append(f'<polyline points="{" ".join(pts)}" fill="none" '
                 f'stroke="{ACCENT_STRONG}" stroke-width="{L(2.5):.1f}" '
                 f'stroke-linecap="round" stroke-linejoin="round"/>')
        # green ellipse annotation around the steep upper part of the curve
        p.append(f'<ellipse cx="{X(ax0+(ax1-ax0)*0.82):.1f}" cy="{Y(cyt+58):.1f}" '
                 f'rx="{L(38):.1f}" ry="{L(30):.1f}" fill="none" stroke="#2ecc71" '
                 f'stroke-width="{L(3):.1f}"/>')


def _annotation_rail(p, rail_x, rail_y, sc=1.0, horizontal=False):
    """The floating annotation rail (real 40px buttons, scaled by sc)."""
    items = [
        ("hand", True, INK), ("spotlight", False, INK),
        ("pen", False, "#333333"), ("pen", False, "#e74c3c"),
        ("highlight", False, "#f1c40f"), ("highlight", False, "#2ecc71"),
        ("pen", False, "#3498db"), ("eraser", False, INK),
        ("undo", False, INK), ("redo", False, INK), ("clear", False, INK),
    ]
    BTN, GAP, PAD = 40*sc, 4*sc, 9*sc
    div_before = {8, 10}      # before undo and before clear
    n = len(items)
    span = PAD*2 + n*BTN + (n-1)*GAP + len(div_before)*(GAP+1)
    if horizontal:
        rail_w, rail_h = span, PAD*2 + BTN
    else:
        rail_w, rail_h = PAD*2 + BTN, span
    p.append(f'<rect x="{rail_x:.1f}" y="{rail_y:.1f}" width="{rail_w:.1f}" '
             f'height="{rail_h:.1f}" rx="{12*sc:.1f}" fill="{RAIL_BG}" '
             f'stroke="{HAIRLINE}" stroke-width="1.5"/>')
    cur = PAD
    for i, (nm, sel, col) in enumerate(items):
        if i in div_before:
            d = cur + GAP/2
            if horizontal:
                p.append(f'<line x1="{rail_x+d:.1f}" y1="{rail_y+PAD}" '
                         f'x2="{rail_x+d:.1f}" y2="{rail_y+rail_h-PAD}" '
                         f'stroke="{HAIRLINE}" stroke-width="1"/>')
            else:
                p.append(f'<line x1="{rail_x+PAD}" y1="{rail_y+d:.1f}" '
                         f'x2="{rail_x+rail_w-PAD}" y2="{rail_y+d:.1f}" '
                         f'stroke="{HAIRLINE}" stroke-width="1"/>')
            cur += GAP + 1
        bx = rail_x + (cur if horizontal else PAD)
        by = rail_y + (PAD if horizontal else cur)
        p.append(_fbtn(nm, bx, by, BTN, BTN, sel=sel, stroke=col, chrome=sel))
        cur += BTN + GAP
    return rail_w, rail_h


def overview():
    # Figure = scaled drawing of the real 1280x720 app, in a window chrome.
    s = 0.62
    bar_h = 30
    ox, oy = 24, 70                            # content top-left in figure
    cw, ch = APP_W * s, APP_H * s
    win_x, win_y, win_w, win_h = ox, oy - bar_h, cw, ch + bar_h
    W = win_x * 2 + win_w
    H = win_y + win_h + win_y       # symmetric margin, no legend

    def X(v): return ox + v * s               # real-x  -> figure-x
    def Y(v): return oy + v * s
    def L(v): return v * s                     # real length -> figure length

    p = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.0f} {H:.0f}" '
         f'width="{W:.0f}" height="{H:.0f}" font-family="sans-serif">',
         f'<rect width="{W:.0f}" height="{H:.0f}" fill="#FFFFFF"/>']

    cx1, cy0, cy1 = _window_frame(p, win_x, win_y, win_w, win_h, bar_h)

    # stage backdrop (rounded bottom corners, matching the window)
    p.append(f'<path d="{_rrect_path(ox, oy, cw, ch, 14, "br,bl")}" fill="{STAGE}"/>')

    # ---- navigator (real: x0 w132, full height; full-width pill buttons) ----
    p.append(f'<path d="{_rrect_path(X(0), Y(0), L(132), ch, 14, "bl")}" '
             f'fill="{CREAM}"/>')
    p.append(f'<line x1="{X(132)}" y1="{Y(0)}" x2="{X(132)}" y2="{cy1}" '
             f'stroke="{BORDER}" stroke-width="1"/>')
    # split-view toggle pill (real 12,12,107,40)
    p.append(_fbtn("split-toggle", X(12), Y(12), L(107), L(40)))
    # thumbnails (real width ~92, 4:3, centered) — first active
    for i, ty in enumerate([72, 160, 248, 336, 424]):
        active = (i == 1)
        p.append(f'<rect x="{X(20)}" y="{Y(ty)}" width="{L(92)}" height="{L(69)}" '
                 f'rx="4" fill="{SLIDE}" stroke="{ACCENT_STRONG if active else BORDER}" '
                 f'stroke-width="{2 if active else 1}"/>')
        p.append(f'<line x1="{X(30)}" y1="{Y(ty+18)}" x2="{X(86)}" y2="{Y(ty+18)}" '
                 f'stroke="{BORDER}" stroke-width="2"/>')
        p.append(f'<line x1="{X(30)}" y1="{Y(ty+34)}" x2="{X(100)}" y2="{Y(ty+34)}" '
                 f'stroke="{INK_4}" stroke-width="1.5"/>')
    # bottom action pills stacked (real 12,572 / 620 / 668, each 107x40)
    for nm, ry in [("add-blank", 572), ("delete-blank", 620), ("bookmark", 668)]:
        p.append(_fbtn(nm, X(12), Y(ry), L(107), L(40)))

    # ---- center slide (real ~326,125,627,470) -------------------------------
    srx, sry, srw, srh = 326, 125, 627, 470
    sx, sy, sw, sh = X(srx), Y(sry), L(srw), L(srh)
    p.append(f'<rect x="{sx+3:.1f}" y="{sy+4:.1f}" width="{sw:.1f}" height="{sh:.1f}" '
             f'rx="6" fill="#000000" fill-opacity="0.06"/>')
    p.append(f'<rect x="{sx:.1f}" y="{sy:.1f}" width="{sw:.1f}" height="{sh:.1f}" '
             f'rx="6" fill="{SLIDE}" stroke="{BORDER}" stroke-width="1"/>')
    _slide_content(p, sx, sy, sw, sh, s, title="Sorting Algorithms", variant=0)

    # ---- annotation rail (real x1210 y101) ----------------------------------
    rail_x, rail_y = X(1210), Y(101)
    _annotation_rail(p, rail_x, rail_y, sc=s)

    # ---- top-right cluster: upload(1132) save(1176) edit(1228), y12 ---------
    for nm, rx in [("upload", 1132), ("save", 1176), ("edit-mode", 1228)]:
        p.append(_fbtn(nm, X(rx), Y(12), L(40), L(40)))
    # ---- bottom-right cluster: tour(1132) help(1176) settings(1220), y668 ---
    for nm, rx in [("tour", 1132), ("help", 1176), ("settings", 1220)]:
        p.append(_fbtn(nm, X(rx), Y(668), L(40), L(40)))

    _window_finish(p, win_x, win_y, win_w, win_h)

    # ---- callout discs (referenced from the paper text; no legend) ----------
    for n, mx, my in [
        (1, X(132), Y(330)),          # navigator
        (2, X(119), Y(32)),           # split-view toggle
        (3, X(326+627/2), Y(125)),    # slide stage
        (4, X(1210), Y(130)),         # annotation rail
        (5, X(1154), Y(64)),          # upload / save
        (6, X(1248), Y(64)),          # edit mode
        (7, X(1176), Y(660)),         # quick actions
    ]:
        p.append(_marker(n, mx, my))

    p.append('</svg>')
    return "".join(p)


def overview_split():
    """Figure variant showing split-view mode: two slides side by side, a
    horizontal annotation toolbar on top, and the navigator as a bottom
    filmstrip (matches body.split-view-active CSS)."""
    s = 0.62
    bar_h = 30
    ox, oy = 24, 70
    cw, ch = APP_W * s, APP_H * s
    win_x, win_y, win_w, win_h = ox, oy - bar_h, cw, ch + bar_h
    W = win_x * 2 + win_w
    H = win_y + win_h + win_y       # symmetric margin, no legend

    def X(v): return ox + v * s
    def Y(v): return oy + v * s
    def L(v): return v * s

    p = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.0f} {H:.0f}" '
         f'width="{W:.0f}" height="{H:.0f}" font-family="sans-serif">',
         f'<rect width="{W:.0f}" height="{H:.0f}" fill="#FFFFFF"/>']

    cx1, cy0, cy1 = _window_frame(p, win_x, win_y, win_w, win_h, bar_h)

    # stage backdrop (full width — navigator moves to the bottom)
    p.append(f'<path d="{_rrect_path(ox, oy, cw, ch, 14, "br,bl")}" fill="{STAGE}"/>')

    # ---- two DIFFERENT slides side by side (real upper area, h=720-88) ------
    srw, srh = 587, 440
    for srx, stitle, svar in [(43, "Sorting Algorithms", 0),
                              (650, "Big-O Growth", 1)]:
        sx, sy, sw, sh = X(srx), Y(96), L(srw), L(srh)
        p.append(f'<rect x="{sx+3:.1f}" y="{sy+4:.1f}" width="{sw:.1f}" '
                 f'height="{sh:.1f}" rx="6" fill="#000000" fill-opacity="0.06"/>')
        p.append(f'<rect x="{sx:.1f}" y="{sy:.1f}" width="{sw:.1f}" height="{sh:.1f}" '
                 f'rx="6" fill="{SLIDE}" stroke="{BORDER}" stroke-width="1"/>')
        _slide_content(p, sx, sy, sw, sh, s * 0.94, title=stitle, variant=svar)
    # split divider hint between them
    p.append(f'<line x1="{X(640)}" y1="{Y(110)}" x2="{X(640)}" y2="{Y(524)}" '
             f'stroke="{BORDER}" stroke-width="1" stroke-dasharray="4 4"/>')

    # ---- bottom filmstrip navigator (real 0,632,1280,88) -------------------
    p.append(f'<path d="{_rrect_path(X(0), Y(632), L(1280), L(88), 14, "br,bl")}" '
             f'fill="{CREAM}"/>')
    p.append(f'<line x1="{X(0)}" y1="{Y(632)}" x2="{X(1280)}" y2="{Y(632)}" '
             f'stroke="{BORDER}" stroke-width="1"/>')
    # split-toggle pill at left (active), then a row of split thumbnails.
    p.append(_fbtn("split-toggle", X(12), Y(656), L(48), L(40), sel=True))
    tw, th = 88, 64                  # thumbnail size (real px)
    tx = 76
    for i in range(9):
        active = (i == 1)
        bx, by = X(tx), Y(644)
        p.append(f'<rect x="{bx:.1f}" y="{by:.1f}" width="{L(tw):.1f}" '
                 f'height="{L(th):.1f}" rx="4" fill="{SLIDE}" '
                 f'stroke="{ACCENT_STRONG if active else BORDER}" '
                 f'stroke-width="{2 if active else 1}"/>')
        # each thumbnail shows its two panes (left | right) of the split
        mid = X(tx + tw/2)
        p.append(f'<line x1="{mid:.1f}" y1="{by:.1f}" x2="{mid:.1f}" '
                 f'y2="{Y(644+th):.1f}" stroke="{BORDER}" stroke-width="1"/>')
        # left pane: text lines; right pane: a figure block — so they differ
        p.append(f'<line x1="{X(tx+8)}" y1="{Y(660)}" x2="{X(tx+36)}" y2="{Y(660)}" '
                 f'stroke="{INK_4}" stroke-width="1.5"/>')
        p.append(f'<line x1="{X(tx+8)}" y1="{Y(668)}" x2="{X(tx+32)}" y2="{Y(668)}" '
                 f'stroke="{INK_4}" stroke-width="1.5"/>')
        p.append(f'<line x1="{X(tx+8)}" y1="{Y(676)}" x2="{X(tx+38)}" y2="{Y(676)}" '
                 f'stroke="{INK_4}" stroke-width="1.5"/>')
        p.append(f'<rect x="{X(tx+50)}" y="{Y(656)}" width="{L(30):.1f}" '
                 f'height="{L(24):.1f}" rx="2" fill="none" stroke="{INK_4}" '
                 f'stroke-width="1.5"/>')
        tx += 100

    # ---- horizontal annotation toolbar, top-center -------------------------
    # width of the horizontal rail in REAL px, centered in the app width
    rail_w_est = 9*2 + 11*40 + 10*4 + 2*(4+1)
    rail_x = X((APP_W - rail_w_est) / 2)
    _annotation_rail(p, rail_x, Y(12), sc=s, horizontal=True)

    # ---- top-right cluster: upload / save / edit (split: top sp-2 = 8) ------
    for nm, rx in [("upload", 1132), ("save", 1176), ("edit-mode", 1228)]:
        p.append(_fbtn(nm, X(rx), Y(8), L(40), L(40)))

    _window_finish(p, win_x, win_y, win_w, win_h)

    # ---- callout discs (referenced from the paper text; no legend) ----------
    # numbering continues from overview.svg (1-7) so refs stay unique.
    # Only two callouts here: the split dividing line and the slide navigator.
    for n, mx, my in [
        (8, X(640), Y(110)),    # dividing line between the two slides
        (9, X(120), Y(632)),    # slide navigator (filmstrip)
    ]:
        p.append(_marker(n, mx, my))

    p.append('</svg>')
    return "".join(p)


def overview_edit():
    """Third figure: edit mode. The editor panel opens on the right (272px real),
    the annotation rail and bottom controls are hidden, a slide element is
    selected on the canvas, and the panel footer offers insert actions."""
    s = 0.62
    bar_h = 30
    ox, oy = 24, 70
    cw, ch = APP_W * s, APP_H * s
    win_x, win_y, win_w, win_h = ox, oy - bar_h, cw, ch + bar_h
    W = win_x * 2 + win_w
    H = win_y + win_h + win_y

    def X(v): return ox + v * s
    def Y(v): return oy + v * s
    def L(v): return v * s

    p = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.0f} {H:.0f}" '
         f'width="{W:.0f}" height="{H:.0f}" font-family="sans-serif">',
         f'<rect width="{W:.0f}" height="{H:.0f}" fill="#FFFFFF"/>']

    cx1, cy0, cy1 = _window_frame(p, win_x, win_y, win_w, win_h, bar_h)

    # stage + navigator (same as standard view)
    p.append(f'<path d="{_rrect_path(ox, oy, cw, ch, 14, "br,bl")}" fill="{STAGE}"/>')
    p.append(f'<path d="{_rrect_path(X(0), Y(0), L(132), ch, 14, "bl")}" fill="{CREAM}"/>')
    p.append(f'<line x1="{X(132)}" y1="{Y(0)}" x2="{X(132)}" y2="{cy1}" '
             f'stroke="{BORDER}" stroke-width="1"/>')
    p.append(_fbtn("split-toggle", X(12), Y(12), L(107), L(40)))
    for i, ty in enumerate([72, 160, 248, 336, 424]):
        active = (i == 1)
        p.append(f'<rect x="{X(20)}" y="{Y(ty)}" width="{L(92)}" height="{L(69)}" rx="4" '
                 f'fill="{SLIDE}" stroke="{ACCENT_STRONG if active else BORDER}" '
                 f'stroke-width="{2 if active else 1}"/>')
        p.append(f'<line x1="{X(30)}" y1="{Y(ty+18)}" x2="{X(86)}" y2="{Y(ty+18)}" '
                 f'stroke="{BORDER}" stroke-width="2"/>')
        p.append(f'<line x1="{X(30)}" y1="{Y(ty+34)}" x2="{X(100)}" y2="{Y(ty+34)}" '
                 f'stroke="{INK_4}" stroke-width="1.5"/>')
    for nm, ry in [("add-blank", 572), ("delete-blank", 620), ("bookmark", 668)]:
        p.append(_fbtn(nm, X(12), Y(ry), L(107), L(40)))

    # ---- slide (centered in the visible stage 132..1008), element selected --
    srx, sry, srw, srh = 300, 158, 540, 405
    sx, sy, sw, sh = X(srx), Y(sry), L(srw), L(srh)
    csf = s * 0.86
    p.append(f'<rect x="{sx+3:.1f}" y="{sy+4:.1f}" width="{sw:.1f}" height="{sh:.1f}" '
             f'rx="6" fill="#000000" fill-opacity="0.06"/>')
    p.append(f'<rect x="{sx:.1f}" y="{sy:.1f}" width="{sw:.1f}" height="{sh:.1f}" '
             f'rx="6" fill="{SLIDE}" stroke="{BORDER}" stroke-width="1"/>')
    _slide_content(p, sx, sy, sw, sh, csf, title="Sorting Algorithms", variant=0)
    # selection box + corner handles around the interactive-widget placeholder
    wx, wy = sx + 310*csf, sy + 230*csf
    ww, wh = 240*csf, 160*csf
    p.append(f'<rect x="{wx-3:.1f}" y="{wy-3:.1f}" width="{ww+6:.1f}" height="{wh+6:.1f}" '
             f'rx="4" fill="none" stroke="{ACCENT_STRONG}" stroke-width="1.5" '
             f'stroke-dasharray="5 4"/>')
    for hx, hy in [(wx-3, wy-3), (wx+ww+3, wy-3), (wx-3, wy+wh+3), (wx+ww+3, wy+wh+3)]:
        p.append(f'<rect x="{hx-3:.1f}" y="{hy-3:.1f}" width="6" height="6" '
                 f'fill="{PAPER}" stroke="{ACCENT_STRONG}" stroke-width="1.25"/>')

    # ---- editor panel (right, 272px real) -----------------------------------
    pnl_x = X(1008)
    p.append(f'<path d="{_rrect_path(X(1008), Y(0), L(272), ch, 14, "br")}" fill="{CREAM}"/>')
    p.append(f'<line x1="{pnl_x}" y1="{Y(0)}" x2="{pnl_x}" y2="{cy1}" '
             f'stroke="{BORDER}" stroke-width="1"/>')
    p.append(f'<text x="{X(1024)}" y="{Y(37)}" font-size="{L(16):.1f}" font-weight="600" '
             f'fill="{INK}" font-family="Georgia, serif">Edit Presentation</text>')
    p.append(f'<line x1="{pnl_x}" y1="{Y(58)}" x2="{cx1}" y2="{Y(58)}" '
             f'stroke="{BORDER}" stroke-width="1"/>')
    ix = 1024  # inner-left, real px
    p.append(f'<text x="{X(ix)}" y="{Y(86)}" font-size="{L(10):.1f}" font-weight="700" '
             f'fill="{INK_3}">SLIDE</text>')
    p.append(f'<rect x="{X(ix)}" y="{Y(98)}" width="{L(13):.1f}" height="{L(13):.1f}" rx="2" '
             f'fill="{PAPER}" stroke="{INK_3}" stroke-width="1.25"/>')
    p.append(f'<text x="{X(ix+22)}" y="{Y(109)}" font-size="{L(12):.1f}" fill="{INK_2}">'
             f'Hide in presentation</text>')
    p.append(f'<text x="{X(ix)}" y="{Y(142)}" font-size="{L(15):.1f}" font-weight="500" '
             f'fill="{INK}" font-family="Georgia, serif">Properties</text>')
    for i, lab in enumerate(["Source", "Size", "Loop"]):
        ry = 162 + i*40
        p.append(f'<text x="{X(ix)}" y="{Y(ry)}" font-size="{L(11):.1f}" fill="{INK_3}">'
                 f'{lab}</text>')
        p.append(f'<rect x="{X(ix)}" y="{Y(ry+6)}" width="{L(240):.1f}" height="{L(22):.1f}" '
                 f'rx="5" fill="{PAPER}" stroke="{BORDER}" stroke-width="1"/>')
    p.append(f'<text x="{X(ix)}" y="{Y(300)}" font-size="{L(15):.1f}" font-weight="500" '
             f'fill="{INK}" font-family="Georgia, serif">View Configuration</text>')
    p.append(f'<text x="{X(ix)}" y="{Y(327)}" font-size="{L(11):.1f}" fill="{INK_3}">'
             f'Autoplay</text>')
    p.append(f'<rect x="{X(ix+200)}" y="{Y(319)}" width="{L(34):.1f}" height="{L(18):.1f}" '
             f'rx="{L(9):.1f}" fill="{CREAM2}" stroke="{BORDER}" stroke-width="1"/>')
    p.append(f'<circle cx="{X(ix+210):.1f}" cy="{Y(328):.1f}" r="{L(7):.1f}" '
             f'fill="{PAPER}" stroke="{BORDER}" stroke-width="1"/>')
    # add-media footer — five ghost icon buttons, centered
    p.append(f'<line x1="{pnl_x}" y1="{Y(663)}" x2="{cx1}" y2="{Y(663)}" '
             f'stroke="{BORDER}" stroke-width="1"/>')
    for i, nm in enumerate(["add-view", "add-video", "add-audio", "add-model", "add-widget"]):
        p.append(_fbtn(nm, X(1036 + i*44), Y(672), L(40), L(40), chrome=False))

    # ---- top-right: exit edit mode (close X) --------------------------------
    p.append(_fbtn("delete-blank", X(1228), Y(12), L(40), L(40), chrome=False))

    _window_finish(p, win_x, win_y, win_w, win_h)

    # ---- callout discs (numbering continues: 10-13) -------------------------
    for n, mx, my in [
        (10, wx + ww, wy),       # selected element on the canvas
        (11, X(1008), Y(190)),   # editor / properties panel
        (12, X(1030), Y(663)),   # add-media footer
        (13, X(1210), Y(14)),    # exit edit mode
    ]:
        p.append(_marker(n, mx, my))

    p.append('</svg>')
    return "".join(p)


# ----------------------------------------------------------------------------
# Emit
# ----------------------------------------------------------------------------
def write(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)


def export_pdfs():
    """Convert every generated .svg under HERE to a sibling .pdf for LaTeX.
    Uses the pure-Python svglib + reportlab (no native deps), so it runs
    anywhere. Skips gracefully (with install hint) if they're missing."""
    import glob
    try:
        from svglib.svglib import svg2rlg
        from reportlab.graphics import renderPDF
    except ImportError:
        print("PDF export skipped — install the converters with:")
        print("    pip install svglib reportlab")
        return
    # svglib is chatty about minor unsupported attrs; quiet its logger.
    import logging
    logging.getLogger("svglib").setLevel(logging.ERROR)
    svgs = sorted(glob.glob(os.path.join(HERE, "**", "*.svg"), recursive=True))
    n = 0
    for svg in svgs:
        drawing = svg2rlg(svg)
        if drawing is None:
            print(f"  ! could not parse {os.path.relpath(svg)}")
            continue
        renderPDF.drawToFile(drawing, svg[:-4] + ".pdf")
        n += 1
    print(f"Wrote {n} PDFs alongside the SVGs.")


def main():
    icons_dir   = os.path.join(HERE, "icons")
    buttons_dir = os.path.join(HERE, "buttons")
    tb_dir      = os.path.join(HERE, "toolbars")

    # --- bare icons + buttons -------------------------------------------------
    for name in ICONS:
        write(os.path.join(icons_dir, f"{name}.svg"), bare_icon(name))
        write(os.path.join(buttons_dir, f"{name}.svg"), button(name))

    # selected-state variants for the interactive tools
    for name in ["hand", "spotlight", "pen", "highlight", "eraser"]:
        write(os.path.join(buttons_dir, f"{name}--selected.svg"),
              button(name, selected=True))

    # colored pen-slot buttons (match the app's default pen palette)
    for slot, mode, color in PEN_PROFILES:
        glyph = "highlight" if mode == "highlight" else "pen"
        write(os.path.join(buttons_dir, f"{slot}.svg"),
              button(glyph, stroke=color))
        write(os.path.join(icons_dir, f"{slot}.svg"),
              bare_icon(glyph, stroke=color))

    # --- composite toolbars ---------------------------------------------------
    # Annotation rail (vertical), pen slots in their real colors, hand selected.
    ann_items = [
        {"name": "hand", "selected": True},
        {"name": "spotlight"},
    ]
    for _slot, mode, color in PEN_PROFILES:
        ann_items.append({"name": "highlight" if mode == "highlight" else "pen",
                          "stroke": color})
    ann_items.append({"name": "eraser"})
    ann_items += [{"name": "undo"}, {"name": "redo"}, {"name": "clear"}]
    # dividers before undo (index 8) and before clear (index 10)
    write(os.path.join(tb_dir, "annotation-toolbar.svg"),
          toolbar(ann_items, vertical=True, dividers={8, 10}))
    write(os.path.join(tb_dir, "annotation-toolbar-horizontal.svg"),
          toolbar(ann_items, vertical=False, dividers={8, 10}))

    # Bottom controls
    write(os.path.join(tb_dir, "bottom-controls.svg"),
          toolbar([{"name": "tour"}, {"name": "help"}, {"name": "settings"}],
                  vertical=False))

    # Top-right controls (upload + save)
    write(os.path.join(tb_dir, "top-right-controls.svg"),
          toolbar([{"name": "upload"}, {"name": "save"}], vertical=False))

    # Editor add-media row
    write(os.path.join(tb_dir, "editor-add-row.svg"),
          toolbar([{"name": "add-view"}, {"name": "add-video"},
                   {"name": "add-audio"}, {"name": "add-model"},
                   {"name": "add-widget"}], vertical=False))

    # Slide-navigator bottom actions
    write(os.path.join(tb_dir, "slide-nav-actions.svg"),
          toolbar([{"name": "add-blank"}, {"name": "delete-blank"},
                   {"name": "bookmark"}], vertical=False))

    # --- composite overview (Figure 1) ---------------------------------------
    write(os.path.join(HERE, "overview.svg"), overview())
    write(os.path.join(HERE, "overview-split.svg"), overview_split())
    write(os.path.join(HERE, "overview-edit.svg"), overview_edit())

    # --- contact sheet --------------------------------------------------------
    write(os.path.join(HERE, "index.html"), contact_sheet())

    print("Done. Wrote icons/, buttons/, toolbars/, and index.html under",
          os.path.relpath(HERE))

    # --- PDF export (for \includegraphics) -----------------------------------
    export_pdfs()


def contact_sheet():
    def card(title, rel):
        return (f'<figure><img src="{rel}" alt="{title}">'
                f'<figcaption>{title}<br><code>{rel}</code></figcaption></figure>')

    cards = ["<h2>Figure 1 — interface overview</h2>"
             "<figure style='text-align:left'><img src='overview.svg' "
             "style='height:auto;max-width:100%;border:1px solid #E5E6E8;border-radius:10px'>"
             "<figcaption><code>overview.svg</code></figcaption></figure>"
             "<h2>Figure 1b — split view</h2>"
             "<figure style='text-align:left'><img src='overview-split.svg' "
             "style='height:auto;max-width:100%;border:1px solid #E5E6E8;border-radius:10px'>"
             "<figcaption><code>overview-split.svg</code></figcaption></figure>"
             "<h2>Figure 1c — edit mode</h2>"
             "<figure style='text-align:left'><img src='overview-edit.svg' "
             "style='height:auto;max-width:100%;border:1px solid #E5E6E8;border-radius:10px'>"
             "<figcaption><code>overview-edit.svg</code></figcaption></figure>"]
    cards.append("<h2>Buttons (with chrome)</h2><div class='grid'>")
    for name in ICONS:
        cards.append(card(LABELS.get(name, name), f"buttons/{name}.svg"))
    cards.append("</div>")

    cards.append("<h2>Pen slots (app palette)</h2><div class='grid'>")
    for slot, mode, color in PEN_PROFILES:
        cards.append(card(f"{slot} ({mode}, {color})", f"buttons/{slot}.svg"))
    cards.append("</div>")

    cards.append("<h2>Selected-state tools</h2><div class='grid'>")
    for name in ["hand", "spotlight", "pen", "highlight", "eraser"]:
        cards.append(card(f"{LABELS[name]} (selected)", f"buttons/{name}--selected.svg"))
    cards.append("</div>")

    cards.append("<h2>Toolbars</h2><div class='grid grid--wide'>")
    for t, lab in [
        ("annotation-toolbar.svg", "Annotation rail (vertical)"),
        ("annotation-toolbar-horizontal.svg", "Annotation rail (horizontal)"),
        ("bottom-controls.svg", "Bottom controls"),
        ("top-right-controls.svg", "Top-right controls"),
        ("editor-add-row.svg", "Editor add-media row"),
        ("slide-nav-actions.svg", "Slide-navigator actions"),
    ]:
        cards.append(card(lab, f"toolbars/{t}"))
    cards.append("</div>")

    cards.append("<h2>Inline usage example</h2>"
                 "<p class='inline-demo'>The user can upload "
                 "<img class='inline' src='buttons/upload.svg'> a presentation, "
                 "annotate with a pen <img class='inline' src='buttons/pen-1.svg'> "
                 "or highlighter <img class='inline' src='buttons/pen-3.svg'>, "
                 "and open settings <img class='inline' src='buttons/settings.svg'> "
                 "at any time.</p>")

    body = "\n".join(cards)
    return f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<title>Beamer+ UI assets</title>
<style>
  body {{ font-family: -apple-system, system-ui, sans-serif; margin: 2rem;
          color: #2C2F36; background: #FCFCFB; }}
  h1 {{ font-weight: 600; }}
  h2 {{ margin-top: 2rem; border-bottom: 1px solid #D6D7DA; padding-bottom: .3rem; }}
  .grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(150px,1fr));
           gap: 1rem; }}
  .grid--wide {{ grid-template-columns: repeat(auto-fill, minmax(260px,1fr)); }}
  figure {{ margin: 0; padding: 1rem; border: 1px solid #E5E6E8; border-radius: 10px;
            text-align: center; background: #fff; }}
  figure img {{ height: 40px; }}
  .grid--wide figure img {{ height: auto; max-width: 100%; max-height: 220px; }}
  figcaption {{ font-size: 12px; color: #6B6D71; margin-top: .6rem; }}
  code {{ font-size: 11px; color: #8a8c90; }}
  .inline {{ height: 1.1em; vertical-align: -0.2em; }}
  .inline-demo {{ font-size: 18px; line-height: 1.8; max-width: 40rem; }}
</style></head>
<body>
<h1>Beamer+ UI assets</h1>
<p>Auto-generated by <code>generate_ui_svgs.py</code>. Each tile links its file path.</p>
{body}
</body></html>"""


if __name__ == "__main__":
    main()
