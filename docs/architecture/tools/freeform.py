# -*- coding: utf-8 -*-
"""자유 배치 다이어그램 — 좌표를 직접 잡되 겹침은 체커가 보증한다.

열 기반 엔진(layout.py)은 파이프라인에 맞지만, 플레인별로 묶는 2D 배치는 표현하지 못한다.
이 모듈은 노드·구역·경로를 명시적으로 놓고, 만들어진 선분을 check_overlap 에 그대로 넘긴다.
따라서 배치는 손으로 잡아도 "선이 상자를 관통하는가 / 선끼리 겹치는가"는 기계가 판정한다.
"""
from xml.sax.saxutils import escape

ROLE = {
    "user":  ("#FFFFFF", "#5A6C7B"),
    "svc":   ("#E1EDF4", "#1D4E6F"),
    "media": ("#EAE5F5", "#5B4B8A"),
    "ai":    ("#E4F2EB", "#2C7A5B"),
    "store": ("#F8EFDD", "#A96F16"),
    "ext":   ("#F1F4F6", "#8C9AA6"),
}
BG, INK, SUB, LBL, EDGE = "#FFFFFF", "#0F1B2A", "#4A5A6B", "#41525F", "#5A6C7B"
ZONE_FILL, ZONE_LINE, ZONE_TXT = "#F5F8FA", "#C6D2DB", "#3F5162"
ZONE_BAR = "#8FA3B4"
LSIZE = 11.5


def tw(s, px):
    return sum(px * (1.0 if ord(c) > 0x1100 else 0.55) for c in s)


class Free:
    """nodes: id -> (title, sub, role, x, y, w, h)
       zones: (label, x, y, w, h)
       edges: (points, label, label_xy, kind)  — points 는 직교 꺾은선 [(x,y), ...]"""

    def __init__(self, title, size, zones, nodes, edges, note=None, legend=None):
        self.title, self.note, self.legend = title, note, legend
        self.width, self.height = size
        self.zones, self.edges_in = zones, edges
        self.pos = {i: dict(t=t, sub=s, role=r, x=x, y=y, w=w, h=h,
                            cx=x + w / 2, cy=y + h / 2)
                    for i, (t, s, r, x, y, w, h) in nodes.items()}
        self.segs, self.labels = [], []
        for pts, lab, lxy, kind in edges:
            for a, b in zip(pts, pts[1:]):
                if abs(a[1] - b[1]) < 0.5:
                    self.segs.append(("h", a[1], a[0], b[0]))
                else:
                    self.segs.append(("v", a[0], a[1], b[1]))
            if lab:
                self.labels.append([lxy[0], lxy[1], lab, lxy[1]])
        self.halos = [self._halo(l) for l in self.labels]

    def _halo(self, l):
        w = tw(l[2], LSIZE) + 13
        return (l[0] - w / 2, l[1] - LSIZE * 0.92, w, LSIZE * 1.55)

    def svg(self):
        o = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {self.width} {self.height}" '
             f'width="{self.width}" height="{self.height}" role="img">',
             f'<title>{escape(self.title)}</title>',
             '<style>text{font-family:system-ui,-apple-system,"Segoe UI",Roboto,'
             '"Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",sans-serif}</style>',
             f'<rect width="100%" height="100%" fill="{BG}"/>']

        for lab, x, y, w, h in self.zones:                       # ① 구역
            o.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="4" fill="{ZONE_FILL}" '
                     f'stroke="{ZONE_LINE}" stroke-width="1" stroke-dasharray="4 4"/>')
            o.append(f'<rect x="{x+14}" y="{y+10}" width="4" height="15" rx="1" fill="{ZONE_BAR}"/>')
            o.append(f'<text x="{x+26}" y="{y+23}" font-size="13" font-weight="700" '
                     f'fill="{ZONE_TXT}" letter-spacing="1.6">{escape(lab)}</text>')

        for pts, lab, lxy, kind in self.edges_in:                # ② 선
            # kind="link" 는 "붙어 있다"는 연결선 — 방향이 없으므로 화살촉을 달지 않는다.
            # 화살촉이 달린 선은 전부 "데이터가 이 방향으로 이동한다"는 뜻이다.
            col = "#D9342B" if kind == "hot" else ("#9DAAB6" if kind == "link" else EDGE)
            wdt = 2 if kind == "hot" else (1.2 if kind == "link" else 1.6)
            d = f'M{pts[0][0]},{pts[0][1]}' + "".join(
                (f' H{b[0]}' if abs(a[1] - b[1]) < 0.5 else f' V{b[1]}')
                for a, b in zip(pts, pts[1:]))
            o.append(f'<path d="{d}" fill="none" stroke="{col}" stroke-width="{wdt}"/>')
            if kind == "link":
                continue
            a, b = pts[-2], pts[-1]
            if abs(a[1] - b[1]) < 0.5:
                tip = f'M{b[0]},{b[1]} l-9,-5 l0,10 z' if b[0] > a[0] else f'M{b[0]},{b[1]} l9,-5 l0,10 z'
            else:
                tip = f'M{b[0]},{b[1]} l-5,-9 l10,0 z' if b[1] > a[1] else f'M{b[0]},{b[1]} l-5,9 l10,0 z'
            o.append(f'<path d="{tip}" fill="{col}"/>')

        for (x, y, text, _), h in zip(self.labels, self.halos):  # ③ 라벨
            o.append(f'<rect x="{h[0]:.1f}" y="{h[1]:.1f}" width="{h[2]:.1f}" height="{h[3]:.1f}" '
                     f'fill="{BG}" rx="2"/>')
            o.append(f'<text x="{x}" y="{y}" text-anchor="middle" font-size="{LSIZE}" '
                     f'fill="{LBL}" font-weight="500">{escape(text)}</text>')

        for p in self.pos.values():                              # ④ 노드
            fill, stroke = ROLE[p["role"]]
            o.append(f'<rect x="{p["x"]}" y="{p["y"]}" width="{p["w"]}" height="{p["h"]}" rx="3" '
                     f'fill="{fill}" stroke="{stroke}" stroke-width="1.8"/>')
            if p["sub"]:
                o.append(f'<text x="{p["cx"]}" y="{p["cy"]-3}" text-anchor="middle" font-size="14.5" '
                         f'font-weight="650" fill="{INK}">{escape(p["t"])}</text>')
                o.append(f'<text x="{p["cx"]}" y="{p["cy"]+16}" text-anchor="middle" font-size="11.5" '
                         f'fill="{SUB}">{escape(p["sub"])}</text>')
            else:
                o.append(f'<text x="{p["cx"]}" y="{p["cy"]+5}" text-anchor="middle" font-size="14.5" '
                         f'font-weight="650" fill="{INK}">{escape(p["t"])}</text>')

        if self.legend:
            lx, ly, lw, lh, ltitle, sw, lines = self.legend
            o.append(f'<rect x="{lx}" y="{ly}" width="{lw}" height="{lh}" rx="4" fill="#FFFFFF" '
                     f'stroke="#C6D2DB" stroke-width="1.2"/>')
            o.append(f'<rect x="{lx+18}" y="{ly+18}" width="4" height="15" rx="1" fill="{ZONE_BAR}"/>')
            o.append(f'<text x="{lx+30}" y="{ly+31}" font-size="13" font-weight="700" '
                     f'fill="{ZONE_TXT}" letter-spacing="1.6">{escape(ltitle)}</text>')
            for i, (label, role) in enumerate(sw):
                col, row = i % 3, i // 3
                sx, sy = lx + 30 + col * 218, ly + 60 + row * 32
                fill, stroke = ROLE[role]
                o.append(f'<rect x="{sx}" y="{sy-11}" width="17" height="15" rx="2" '
                         f'fill="{fill}" stroke="{stroke}" stroke-width="1.6"/>')
                o.append(f'<text x="{sx+26}" y="{sy}" font-size="12" fill="{INK}">{escape(label)}</text>')
            base = ly + 60 + ((len(sw) + 2) // 3) * 32 + 8
            for i, (color, label) in enumerate(lines):
                yy = base + i * 26
                o.append(f'<path d="M{lx+30},{yy-4} H{lx+76}" stroke="{color}" '
                         f'stroke-width="{2 if color != EDGE else 1.6}" fill="none"/>')
                o.append(f'<path d="M{lx+76},{yy-4} l-9,-5 l0,10 z" fill="{color}"/>')
                o.append(f'<text x="{lx+90}" y="{yy}" font-size="12" fill="{SUB}">{escape(label)}</text>')

        if self.note:
            y0 = self.height - 22 - 20 * (len(self.note) - 1)
            o.append(f'<line x1="34" y1="{y0-26}" x2="{self.width-34}" y2="{y0-26}" stroke="#E3E9ED"/>')
            for i, line in enumerate(self.note):
                o.append(f'<text x="34" y="{y0+i*20}" font-size="12" fill="{SUB}">{escape(line)}</text>')
        o.append('</svg>')
        return "\n".join(o)
