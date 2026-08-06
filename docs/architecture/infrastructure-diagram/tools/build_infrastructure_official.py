#!/usr/bin/env python3
"""Build the official-icon production infrastructure overview.

The output is a self-contained SVG. Brand paths are read from the vendored
Simple Icons assets and the EC2 mark is read from AWS Architecture Icons.
"""

from __future__ import annotations

import html
import re
from pathlib import Path
from xml.etree import ElementTree as ET


ROOT = Path(__file__).resolve().parents[4]
INFRASTRUCTURE_ROOT = ROOT / "docs" / "architecture" / "infrastructure-diagram"
ICON_ROOT = INFRASTRUCTURE_ROOT / "icons" / "official"
OUTPUT = INFRASTRUCTURE_ROOT / "liveclass-infrastructure.svg"

WIDTH = 2400
HEIGHT = 1350

NAVY = "#17324D"
SLATE = "#334155"
MUTED = "#64748B"
LIGHT = "#F8FAFC"
LINE = "#CBD5E1"
AWS = "#ED7100"
PURPLE = "#7C3AED"
TEAL = "#0891B2"
ORANGE = "#F97316"
BLUE = "#2563EB"

BRAND_COLORS = {
    "docker": "#2496ED",
    "fastapi": "#009688",
    "ffmpeg": "#007808",
    "gitlab": "#FC6D26",
    "huggingface": "#FFD21E",
    "letsencrypt": "#003A70",
    "livekit": "#111827",
    "minio": "#C72E49",
    "nginx": "#009639",
    "nvidia": "#76B900",
    "postgresql": "#4169E1",
    "python": "#3776AB",
    "rabbitmq": "#FF6600",
    "react": "#61DAFB",
    "redis": "#FF4438",
    "springboot": "#6DB33F",
}


def esc(value: str) -> str:
    return html.escape(value, quote=True)


def simple_symbol(name: str) -> str:
    source = ICON_ROOT / "simple-icons" / f"{name}.svg"
    root = ET.parse(source).getroot()
    view_box = root.attrib.get("viewBox", "0 0 24 24")
    paths = []
    for element in root.iter():
        if element.tag.rsplit("}", 1)[-1] != "path":
            continue
        attrs = [f'd="{esc(element.attrib["d"])}"']
        for key in ("fill-rule", "clip-rule"):
            if key in element.attrib:
                attrs.append(f'{key}="{esc(element.attrib[key])}"')
        paths.append(f"<path {' '.join(attrs)}/>")
    return (
        f'<symbol id="icon-{name}" viewBox="{esc(view_box)}">'
        f'<g fill="currentColor">{"".join(paths)}</g></symbol>'
    )


def aws_symbol() -> str:
    source = ICON_ROOT / "aws" / "amazon-ec2.svg"
    raw = source.read_text(encoding="utf-8")
    view_box = re.search(r'viewBox="([^"]+)"', raw)
    if view_box is None:
        raise RuntimeError("AWS EC2 icon has no viewBox")
    root = ET.fromstring(raw)
    body = []
    for child in root:
        if child.tag.rsplit("}", 1)[-1] == "title":
            continue
        body.append(ET.tostring(child, encoding="unicode"))
    return f'<symbol id="icon-amazon-ec2" viewBox="{esc(view_box.group(1))}">{"".join(body)}</symbol>'


def use_icon(name: str, x: float, y: float, size: float, color: str | None = None) -> str:
    style = f' style="color:{color}"' if color else ""
    return f'<use href="#icon-{name}" x="{x}" y="{y}" width="{size}" height="{size}"{style}/>'


def text(x: float, y: float, value: str, *, size: int = 24, weight: int = 500,
         fill: str = SLATE, anchor: str = "start", cls: str = "") -> str:
    class_attr = f' class="{cls}"' if cls else ""
    return (
        f'<text x="{x}" y="{y}" font-size="{size}" font-weight="{weight}" '
        f'fill="{fill}" text-anchor="{anchor}"{class_attr}>{esc(value)}</text>'
    )


def multiline(x: float, y: float, lines: list[str], *, size: int = 22, weight: int = 600,
              fill: str = SLATE, gap: int = 27, anchor: str = "start") -> str:
    tspans = []
    for index, line in enumerate(lines):
        dy = 0 if index == 0 else gap
        tspans.append(f'<tspan x="{x}" dy="{dy}">{esc(line)}</tspan>')
    return (
        f'<text x="{x}" y="{y}" font-size="{size}" font-weight="{weight}" '
        f'fill="{fill}" text-anchor="{anchor}">{"".join(tspans)}</text>'
    )


def rounded_rect(x: float, y: float, w: float, h: float, *, fill: str = "#FFFFFF",
                 stroke: str = LINE, width: float = 2, radius: float = 20,
                 dash: str = "", shadow: bool = False) -> str:
    dash_attr = f' stroke-dasharray="{dash}"' if dash else ""
    filter_attr = ' filter="url(#shadow)"' if shadow else ""
    return (
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{radius}" '
        f'fill="{fill}" stroke="{stroke}" stroke-width="{width}"{dash_attr}{filter_attr}/>'
    )


def label(x: float, y: float, value: str, *, color: str = NAVY, size: int = 18,
          anchor: str = "middle", pad_x: int = 11, pad_y: int = 6) -> str:
    estimated_w = max(48, len(value) * size * 0.55 + pad_x * 2)
    left = x - estimated_w / 2 if anchor == "middle" else x - pad_x
    baseline = y + size * 0.36
    return (
        f'<rect x="{left}" y="{y - size / 2 - pad_y}" width="{estimated_w}" '
        f'height="{size + pad_y * 2}" rx="8" fill="#FFFFFF" fill-opacity="0.94"/>'
        + text(x, baseline, value, size=size, weight=600, fill=color, anchor=anchor)
    )


def path(d: str, *, color: str = NAVY, width: int = 4, marker: str = "navy",
         dash: str = "", opacity: float = 1.0, start: bool = False) -> str:
    dash_attr = f' stroke-dasharray="{dash}"' if dash else ""
    start_attr = f' marker-start="url(#arrow-{marker})"' if start else ""
    end_attr = f' marker-end="url(#arrow-{marker})"' if marker else ""
    return (
        f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{width}" '
        f'stroke-linecap="round" stroke-linejoin="round" opacity="{opacity}"'
        f'{dash_attr}{start_attr}{end_attr}/>'
    )


def tech_card(x: float, y: float, w: float, h: float, icon: str, title_value: str,
              subtitle: str = "", *, color: str | None = None, icon2: str | None = None,
              icon2_color: str | None = None, compact: bool = False) -> str:
    color = color or BRAND_COLORS.get(icon, NAVY)
    pieces = [rounded_rect(x, y, w, h, shadow=True)]
    pieces.append(f'<rect x="{x}" y="{y}" width="{w}" height="6" rx="3" fill="{color}"/>')
    icon_size = 46 if compact else 56
    icon_y = y + (h - icon_size) / 2
    pieces.append(use_icon(icon, x + 22, icon_y, icon_size, color))
    text_x = x + 92
    if icon2:
        pieces.append(use_icon(icon2, x + 74, icon_y + 5, icon_size - 8, icon2_color or BRAND_COLORS.get(icon2, NAVY)))
        text_x = x + 132
    title_y = y + (h / 2 if not subtitle else h / 2 - 10)
    pieces.append(text(text_x, title_y + 7, title_value, size=20 if compact else 24, weight=700, fill=NAVY))
    if subtitle:
        pieces.append(text(text_x, title_y + 36, subtitle, size=17, weight=500, fill=MUTED))
    return "".join(pieces)


def browser_card(x: float, y: float, title_value: str, subtitle: str) -> str:
    w, h = 190, 142
    pieces = [rounded_rect(x, y, w, h, fill="#FFFFFF", stroke=NAVY, width=3, radius=18, shadow=True)]
    pieces.append(f'<rect x="{x}" y="{y}" width="{w}" height="28" rx="16" fill="#E2E8F0"/>')
    for offset, color in ((16, "#FB7185"), (34, "#FBBF24"), (52, "#34D399")):
        pieces.append(f'<circle cx="{x + offset}" cy="{y + 14}" r="5" fill="{color}"/>')
    pieces.append(f'<circle cx="{x + w / 2}" cy="{y + 65}" r="18" fill="{NAVY}"/>')
    pieces.append(f'<path d="M{x + 60} {y + 113} C{x + 62} {y + 84},{x + 128} {y + 84},{x + 130} {y + 113}Z" fill="{NAVY}"/>')
    pieces.append(text(x + w / 2, y + h + 31, title_value, size=23, weight=700, fill=NAVY, anchor="middle"))
    pieces.append(text(x + w / 2, y + h + 55, subtitle, size=17, weight=500, fill=MUTED, anchor="middle"))
    return "".join(pieces)


def marker(marker_id: str, color: str) -> str:
    return (
        f'<marker id="arrow-{marker_id}" viewBox="0 0 10 10" refX="8.5" refY="5" '
        f'markerWidth="9" markerHeight="9" orient="auto-start-reverse">'
        f'<path d="M 0 0 L 10 5 L 0 10 z" fill="{color}"/></marker>'
    )


def build_svg() -> str:
    icon_names = sorted(BRAND_COLORS)
    defs = [simple_symbol(name) for name in icon_names]
    defs.append(aws_symbol())
    defs.extend(
        [
            marker("navy", NAVY),
            marker("purple", PURPLE),
            marker("teal", TEAL),
            marker("orange", ORANGE),
            marker("blue", BLUE),
            """<filter id="shadow" x="-20%" y="-20%" width="140%" height="150%">
              <feDropShadow dx="0" dy="5" stdDeviation="7" flood-color="#0F172A" flood-opacity="0.10"/>
            </filter>""",
        ]
    )

    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{WIDTH}" height="{HEIGHT}" viewBox="0 0 {WIDTH} {HEIGHT}" role="img" aria-labelledby="title desc">',
        '<title id="title">LiveClass AI production infrastructure</title>',
        '<desc id="desc">GitLab CI/CD deploys to an AWS EC2 production host, a GPU Jupyter host, and an auxiliary test and Egress host. The EC2 host runs application, AI, data, media, and object storage services.</desc>',
        f'<defs>{"".join(defs)}</defs>',
        '<rect width="2400" height="1350" fill="#F7F9FC"/>',
        '<path d="M0 120 H2400" stroke="#E2E8F0" stroke-width="2"/>',
        text(1200, 67, "LiveClass AI · Production Infrastructure", size=42, weight=800, fill="#0F2742", anchor="middle"),
        text(1200, 101, "Current workspace topology · containers, host networks, GPU runtime, tunnels, and CI/CD", size=20, weight=500, fill=MUTED, anchor="middle"),
    ]

    # CI/CD lane and deployment paths.
    out.extend(
        [
            tech_card(40, 25, 300, 78, "gitlab", "GitLab Repository", compact=True),
            tech_card(390, 25, 250, 78, "gitlab", "GitLab CI/CD", compact=True),
            path("M340 64 H390", color=PURPLE, marker="purple", width=4),
            path("M515 103 V155 H1150 V225", color=PURPLE, marker="purple", width=3, dash="10 8"),
            path("M515 103 V145 H2240 V640", color=PURPLE, marker="purple", width=3, dash="10 8"),
            path("M515 103 V165 H1855 V865", color=PURPLE, marker="purple", width=3, dash="10 8"),
            label(840, 144, "build · test · deploy", color=PURPLE, size=17),
        ]
    )

    # User side.
    out.extend(
        [
            browser_card(35, 410, "Instructor", "publish · manage"),
            browser_card(35, 770, "Student", "HLS · captions · Q&A"),
            path("M225 480 H350", color=NAVY, marker="navy", width=5),
            path("M225 840 H255 V510 H350", color=NAVY, marker="navy", width=5),
        ]
    )

    # Host and network boundaries.
    out.extend(
        [
            rounded_rect(270, 220, 1420, 1030, fill="#FFFDF8", stroke=AWS, width=4, radius=30, shadow=True),
            use_icon("amazon-ec2", 304, 246, 60),
            text(382, 284, "AWS EC2 · Production", size=32, weight=800, fill="#B45309"),
            text(382, 313, "single-host Docker deployment · app and media paths are isolated", size=18, weight=500, fill=MUTED),
            tech_card(1080, 242, 520, 70, "gitlab", "GitLab Runner · shell executor", "in-place build & deploy", compact=True),
            rounded_rect(310, 330, 980, 870, fill="#F7FBFF", stroke="#3B82F6", width=3, radius=24),
            use_icon("docker", 340, 350, 43, BRAND_COLORS["docker"]),
            text(397, 381, "App & AI · Docker bridge network", size=25, weight=800, fill="#1D4ED8"),
            text(397, 407, "liveclass_default · private service discovery", size=17, weight=500, fill=MUTED),
            rounded_rect(1320, 330, 330, 870, fill="#FCFAFF", stroke=PURPLE, width=3, radius=24),
            use_icon("livekit", 1347, 350, 42, PURPLE),
            text(1402, 381, "Media · host network", size=24, weight=800, fill="#6D28D9"),
            text(1402, 407, "SFU · recording", size=17, weight=500, fill=MUTED),
            rounded_rect(1750, 220, 590, 510, fill="#FBFAFF", stroke="#6B21A8", width=4, radius=30, shadow=True),
            use_icon("nvidia", 1785, 245, 54, BRAND_COLORS["nvidia"]),
            text(1855, 279, "GPU / Jupyter Host · GPU0", size=30, weight=800, fill="#581C87"),
            text(1855, 307, "rootless runtime · outbound-only networking", size=18, weight=500, fill=MUTED),
            rounded_rect(1750, 770, 590, 300, fill="#F5FFFE", stroke="#0F766E", width=4, radius=30, shadow=True),
            text(1788, 817, "8-core Auxiliary Host", size=29, weight=800, fill="#0F766E"),
            text(1788, 845, "test offload + remote Egress worker", size=18, weight=500, fill=MUTED),
            rounded_rect(1750, 1110, 590, 140, fill="#F8FAFF", stroke=BLUE, width=3, radius=24, shadow=True),
            text(1785, 1150, "External Model APIs", size=25, weight=800, fill="#1D4ED8"),
        ]
    )

    # Internal application and media paths. These sit behind the cards.
    out.extend(
        [
            path("M630 485 H700", color=NAVY, marker="navy", width=4),
            path("M945 485 H1020", color=NAVY, marker="navy", width=4),
            path("M822 540 V600", color=TEAL, marker="teal", width=4),
            path("M945 500 H980 V652 H1020", color=NAVY, marker="navy", width=3),
            path("M945 520 H965 V812 H1020", color=ORANGE, marker="orange", width=3),
            path("M1020 812 H945", color=ORANGE, marker="orange", width=4),
            path("M1000 812 V982 H945", color=ORANGE, marker="orange", width=4),
            path("M945 982 H1020", color=ORANGE, marker="orange", width=4),
            path("M490 540 V560 H650 V1160 H1140 V1035", color=BLUE, marker="blue", width=4),
            label(810, 1150, "presigned upload · HLS", color=BLUE, size=15),
            path("M840 540 V565 H1300 V482 H1350", color=PURPLE, marker="purple", width=4),
            path("M1485 535 V570", color=PURPLE, marker="purple", width=4),
            path("M1485 675 V740", color=PURPLE, marker="purple", width=4),
            path("M1485 845 V930", color=PURPLE, marker="purple", width=4),
            path("M1350 982 H1260", color=ORANGE, marker="orange", width=5),
        ]
    )

    # EC2 service cards.
    out.extend(
        [
            tech_card(350, 430, 280, 110, "nginx", "Nginx + React", "TLS edge · SPA", icon2="react", icon2_color=BRAND_COLORS["react"]),
            tech_card(350, 570, 280, 78, "letsencrypt", "Certbot", "certificate renew", compact=True),
            tech_card(700, 430, 245, 110, "springboot", "Spring Boot", "control & data plane"),
            tech_card(700, 600, 245, 110, "fastapi", "ai-api", "RAG · SSE"),
            tech_card(700, 760, 245, 110, "python", "ai-worker", "parse · embed"),
            tech_card(700, 930, 245, 110, "ffmpeg", "media-worker", "MP4 → HLS"),
            tech_card(700, 1070, 245, 85, "nginx", "GPU Proxy", "AI → /internal/bge", compact=True),
            tech_card(1020, 430, 240, 105, "postgresql", "PostgreSQL", "pgvector · core / ai"),
            tech_card(1020, 600, 240, 105, "redis", "Redis", "session · captions"),
            tech_card(1020, 760, 240, 105, "rabbitmq", "RabbitMQ", "jobs · DLQ"),
            tech_card(1020, 930, 240, 105, "minio", "MinIO", "assets · recordings"),
            tech_card(1350, 430, 270, 105, "nginx", "Nginx WSS", "TLS :7443 / :443"),
            tech_card(1350, 570, 270, 105, "livekit", "LiveKit SFU", "signaling · WebRTC"),
            tech_card(1350, 740, 270, 105, "redis", "LiveKit Redis", "SFU ↔ Egress"),
            tech_card(1350, 930, 270, 105, "livekit", "LiveKit Egress", "Chrome · HLS", color=PURPLE),
        ]
    )

    # Cross-host secure paths and external calls.
    out.extend(
        [
            path("M225 520 H250 V415 H1640 V622 H1620", color=PURPLE, marker="purple", width=5),
            path("M1620 622 H1715 V385 H1790", color=PURPLE, marker="purple", width=5),
            path("M1790 420 H1715 V1125 H1285 V652 H1260", color=TEAL, marker="teal", width=4, dash="10 7"),
            path("M822 1155 V1215 H1700 V525 H1790", color=TEAL, marker="teal", width=4, dash="10 7"),
            path("M2050 935 H1690 V800 H1620", color=ORANGE, marker="orange", width=4, dash="10 7"),
            path("M2050 960 H1705 V1080 H1280 V982 H1260", color=ORANGE, marker="orange", width=4, dash="10 7"),
            path("M945 655 H965 V1230 H1750", color=BLUE, marker="blue", width=3, dash="8 7"),
            path("M945 815 H985 V1230 H1750", color=BLUE, marker="blue", width=3, dash="8 7"),
        ]
    )

    # GPU, auxiliary, and external cards.
    out.extend(
        [
            tech_card(1790, 340, 510, 110, "python", "realtime-agent", "Nemotron streaming STT · GPU0"),
            tech_card(1790, 480, 510, 110, "huggingface", "BGE-M3 Runtime", "CUDA embedding service"),
            tech_card(1790, 620, 510, 82, "gitlab", "GitLab Runner", "rootless GPU deployment", compact=True),
            tech_card(1790, 870, 230, 120, "gitlab", "Test Runner", "backend CI", compact=True),
            tech_card(2050, 870, 250, 120, "livekit", "Remote Egress", "worker pool", color=PURPLE, compact=True),
            text(1785, 1186, "GMS LLM Gateway", size=21, weight=700, fill=NAVY),
            text(1785, 1218, "OpenAI Whisper API · recorded STT", size=19, weight=600, fill=MUTED),
        ]
    )

    # Legend.
    out.extend(
        [
            rounded_rect(35, 1078, 195, 215, fill="#FFFFFF", stroke=LINE, width=2, radius=18, shadow=True),
            text(55, 1116, "Flow legend", size=21, weight=800, fill=NAVY),
            path("M58 1147 H105", color=NAVY, marker="navy", width=4),
            text(119, 1154, "App / data", size=16, weight=600, fill=SLATE),
            path("M58 1183 H105", color=PURPLE, marker="purple", width=4),
            text(119, 1190, "WebRTC", size=16, weight=600, fill=SLATE),
            path("M58 1219 H105", color=ORANGE, marker="orange", width=4),
            text(119, 1226, "Queue / HLS", size=16, weight=600, fill=SLATE),
            path("M58 1255 H105", color=TEAL, marker="teal", width=4, dash="8 6"),
            text(119, 1262, "AI / tunnel", size=16, weight=600, fill=SLATE),
        ]
    )

    out.append(text(2360, 1325, "Source: current Compose, Nginx, CI, and deployment configs · 2026-08-05", size=15, weight=500, fill="#94A3B8", anchor="end"))
    out.append("</svg>")
    return "".join(out)


def main() -> None:
    svg = build_svg()
    OUTPUT.write_text(svg, encoding="utf-8")
    ET.parse(OUTPUT)
    print(OUTPUT)


if __name__ == "__main__":
    main()
