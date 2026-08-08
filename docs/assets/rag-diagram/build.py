#!/usr/bin/env python3
"""RAG 하이브리드 검색 다이어그램을 만든다 (발표용).

무엇을 말하려는 그림인가
    "pgvector 한 곳에서 벡터 검색과 키워드 검색이 같이 돌고, RRF로 합쳐진다."
    이 한 문장이 전부다. 세부(스키마·인덱스·청킹)는 일부러 뺐다 — 발표에서 그걸 설명하면
    정작 하고 싶은 말이 묻힌다.

그림이 사실인지
    ai/ai-api/app/adapters/pgvector_material_retrieval.py 의 ACTIVE_MATERIAL_HYBRID_SQL 과 같다.
    벡터는 `embedding <=> :query` (코사인), 키워드는 `ts_rank_cd(search_vector, plainto_tsquery(...))`,
    융합은 `1/(60+vector_rank) + 1/(60+lexical_rank)`. 셋 다 한 쿼리 안에 있다.
    숫자를 바꿀 일이 생기면 저 SQL을 먼저 보고 여기를 맞춘다.

사용법
    npm install sharp        # 이 디렉토리에서 (node_modules는 커밋하지 않는다)
    python3 build.py         # → rag-hybrid-search.svg / .png
"""
from __future__ import annotations

import base64
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ICONS = ROOT.parent / "tech-icons" / "png"
YEONGSIL = ROOT.parents[2] / "frontend" / "src" / "assets" / "yeongsil.png"

# 16:9로 두면 아래가 크게 비어 그림이 위로 쏠린다. 내용에 맞춰 잘라 둔다 — 슬라이드에는
# 어차피 사람이 배치하므로, 빈 canvas를 끼워 넣는 것보다 딱 맞는 편이 낫다.
W, H = 2400, 1420

# infrastructure-diagram 과 같은 팔레트를 쓴다. 두 그림을 같은 덱에 넣어도 톤이 안 깨진다.
NAVY, MUTED, LINE = "#17324D", "#64748B", "#CBD5E1"
BLUE, ORANGE, PURPLE, TEAL = "#2563EB", "#F97316", "#7C3AED", "#0891B2"
BLUE_BG, ORANGE_BG, PURPLE_BG, TEAL_BG = "#EFF6FF", "#FFF7ED", "#F5F3FF", "#ECFEFF"
FONT = "Noto Sans KR, Malgun Gothic, sans-serif"


def image(path: Path, x: float, y: float, size: float, *, circle: bool = False) -> str:
    """PNG를 인라인으로 박는다. 외부 참조를 두면 PPT로 옮길 때 그림이 깨진다.

    circle=True는 사진용이다. 영실 이미지는 배경이 잘린 투명 PNG가 아니라 사각형 사진이라
    그대로 넣으면 흰 슬라이드에 노란 네모가 뜬다. 앱에서도 아바타로 둥글게 쓰고 있다.
    """
    data = base64.b64encode(path.read_bytes()).decode("ascii")
    clip = ""
    if circle:
        cid = f"clip-{abs(hash(str(path))) % 100000}"
        clip = (f'<clipPath id="{cid}"><circle cx="{x + size / 2}" cy="{y + size / 2}" '
                f'r="{size / 2}"/></clipPath>')
        return (
            f'{clip}<image x="{x}" y="{y}" width="{size}" height="{size}" '
            f'preserveAspectRatio="xMidYMid slice" clip-path="url(#{cid})" '
            f'href="data:image/png;base64,{data}"/>'
            f'<circle cx="{x + size / 2}" cy="{y + size / 2}" r="{size / 2}" '
            f'fill="none" stroke="{LINE}" stroke-width="4"/>'
        )
    return (
        f'<image x="{x}" y="{y}" width="{size}" height="{size}" '
        f'preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,{data}"/>'
    )


def text(
    x: float, y: float, value: str, *, size: float, weight: int = 400,
    fill: str = NAVY, anchor: str = "middle",
) -> str:
    return (
        f'<text x="{x}" y="{y}" font-family="{FONT}" font-size="{size}" '
        f'font-weight="{weight}" fill="{fill}" text-anchor="{anchor}">{value}</text>'
    )


def box(x, y, w, h, *, fill, stroke, width=4, radius=24) -> str:
    return (
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{radius}" '
        f'fill="{fill}" stroke="{stroke}" stroke-width="{width}"/>'
    )


def arrow(x1, y1, x2, y2, *, color=NAVY, width=6) -> str:
    return (
        f'<path d="M{x1} {y1} L{x2} {y2}" stroke="{color}" stroke-width="{width}" '
        f'fill="none" marker-end="url(#head-{color.lstrip("#")})"/>'
    )


def curve(x1, y1, x2, y2, *, color, width=6) -> str:
    """가로로 벌어졌다 모이는 연결선. 제어점을 중간 x에 두면 S자가 부드럽다."""
    mid = (x1 + x2) / 2
    return (
        f'<path d="M{x1} {y1} C{mid} {y1}, {mid} {y2}, {x2} {y2}" stroke="{color}" '
        f'stroke-width="{width}" fill="none" marker-end="url(#head-{color.lstrip("#")})"/>'
    )


def head(color: str) -> str:
    return (
        f'<marker id="head-{color.lstrip("#")}" viewBox="0 0 10 10" refX="8" refY="5" '
        f'markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
        f'<path d="M0 0 L10 5 L0 10 Z" fill="{color}"/></marker>'
    )


def build() -> str:
    p: list[str] = []
    p.append(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
             f'viewBox="0 0 {W} {H}">')
    p.append("<defs>")
    p.extend(head(c) for c in (NAVY, BLUE, ORANGE, PURPLE))
    p.append('<filter id="soft" x="-8%" y="-8%" width="116%" height="116%">'
             '<feDropShadow dx="0" dy="6" stdDeviation="10" flood-color="#17324D" '
             'flood-opacity="0.10"/></filter>')
    p.append("</defs>")
    p.append(f'<rect width="{W}" height="{H}" fill="#FFFFFF"/>')

    p.append(text(W / 2, 120, "RAG 하이브리드 검색", size=62, weight=700))

    # ── 위: 미리 색인해 둔 두 가지 ────────────────────────────────────────────
    # 자막을 여기 같이 두면 거짓이 된다. 자막은 임베딩하지 않고 최근 것을 그대로 붙인다.
    p.append(text(990, 196, "미리 색인해 둔 것", size=30, weight=700, fill=MUTED))
    for x_left, title_value, sub in (
        (560, "강의자료", "PPTX 페이지"),
        (1020, "강조 판서", "강사가 강조한 부분"),
    ):
        cx = x_left + 200
        p.append(box(x_left, 230, 400, 140, fill="#FFFFFF", stroke=NAVY, width=4, radius=22))
        p.append(text(cx, 296, title_value, size=42, weight=700))
        p.append(text(cx, 342, sub, size=28, fill=MUTED))
        p.append(arrow(cx, 370, cx, 424))

    # ── 왼쪽: 질문 ───────────────────────────────────────────────────────────
    p.append(image(ICONS / "student.png", 100, 815, 150))
    p.append(text(175, 1035, "수강생 질문", size=40, weight=700))

    p.append(arrow(280, 890, 390, 890))

    # ── 가운데: 한 데이터베이스 안 ────────────────────────────────────────────
    p.append(f'<g filter="url(#soft)">{box(420, 430, 1200, 730, fill="#FFFFFF", stroke=NAVY, width=5, radius=32)}</g>')
    p.append(image(ICONS / "postgresql.png", 472, 472, 84))
    p.append(text(578, 528, "PostgreSQL + pgvector", size=46, weight=700, anchor="start"))
    p.append(text(578, 572, "한 테이블 · 한 쿼리", size=30, fill=MUTED, anchor="start"))
    p.append(f'<path d="M472 612 L1568 612" stroke="{LINE}" stroke-width="3"/>')

    # 질문이 두 갈래로 갈라지는 지점. 점 하나로 두면 "같은 질문"임이 보인다.
    p.append(f'<circle cx="490" cy="890" r="10" fill="{NAVY}"/>')
    p.append(curve(490, 890, 540, 760, color=BLUE))
    p.append(curve(490, 890, 540, 1020, color=ORANGE))

    p.append(box(540, 660, 520, 200, fill=BLUE_BG, stroke=BLUE))
    p.append(text(800, 728, "벡터 검색", size=46, weight=700, fill=BLUE))
    p.append(text(800, 780, "의미가 비슷한 것", size=34))
    p.append(text(800, 826, "임베딩 1024차원 · 코사인", size=26, fill=MUTED))

    p.append(box(540, 920, 520, 200, fill=ORANGE_BG, stroke=ORANGE))
    p.append(text(800, 988, "키워드 검색", size=46, weight=700, fill=ORANGE))
    p.append(text(800, 1040, "단어가 그대로 맞는 것", size=34))
    p.append(text(800, 1086, "PostgreSQL 전문검색", size=26, fill=MUTED))

    p.append(curve(1060, 760, 1150, 890, color=BLUE))
    p.append(curve(1060, 1020, 1150, 890, color=ORANGE))

    p.append(box(1150, 770, 380, 240, fill=PURPLE_BG, stroke=PURPLE))
    p.append(text(1340, 860, "RRF 융합", size=46, weight=700, fill=PURPLE))
    p.append(text(1340, 912, "두 순위를 하나로", size=32))
    p.append(text(1340, 960, "1 / (60 + 순위) 합산", size=26, fill=MUTED))

    p.append(arrow(1530, 890, 1600, 890, color=PURPLE))

    # ── 오른쪽: 자막이 합류해 답변으로 ────────────────────────────────────────
    # 이 열은 상자 밖(x>1620)에만 둔다. 카드가 상자에 걸치면 "DB 안에 있는 것"으로 읽힌다.
    p.append(arrow(1640, 890, 1845, 890))
    p.append(text(1742, 852, "Top-K 근거", size=28, weight=700, fill=MUTED))

    p.append(box(1670, 1060, 380, 150, fill=TEAL_BG, stroke=TEAL, radius=22))
    p.append(text(1860, 1122, "최근 발화", size=42, weight=700, fill=TEAL))
    p.append(text(1860, 1168, "자막 · 검색 없이 그대로", size=26, fill=MUTED))
    # 화살촉 없이 점으로 합류시킨다. 촉이 둘이면 어느 쪽이 본류인지 흐려진다.
    p.append(f'<path d="M1860 1060 L1860 890" stroke="{TEAL}" stroke-width="6" fill="none"/>')
    p.append(f'<circle cx="1860" cy="890" r="11" fill="{NAVY}"/>')

    p.append(arrow(1875, 890, 2020, 890))
    p.append(image(YEONGSIL, 2050, 815, 150, circle=True))
    p.append(text(2125, 1035, "AI 답변", size=40, weight=700))

    p.append(text(1020, 1350, "검색 엔진을 따로 두지 않는다 — SQL 한 번으로 끝난다",
                  size=42, weight=700))
    p.append("</svg>")
    return "".join(p)


if __name__ == "__main__":
    svg_path = ROOT / "rag-hybrid-search.svg"
    svg_path.write_text(build(), encoding="utf-8")
    print(f"SVG  {svg_path}")
    subprocess.run(
        ["node", str(ROOT / "to-png.mjs"), str(svg_path), str(ROOT / "rag-hybrid-search.png")],
        check=True,
    )
