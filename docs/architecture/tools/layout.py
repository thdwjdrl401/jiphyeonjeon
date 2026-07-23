# -*- coding: utf-8 -*-
"""열 기반 아키텍처 다이어그램 렌더러 — 겹침을 구조적으로 배제한다.

불변식
  1. 노드는 열에만 놓이고 화살표는 인접 열 사이 거터에서만 흐른다  → 선이 상자를 관통하지 않는다
  2. 한 노드에서 나가고 들어오는 화살표는 상자 높이에 고르게 분산  → 출발·도착 구간이 겹치지 않는다
  3. 거터 안에서 화살표마다 전용 세로 레인을 갖는다              → 세로 구간이 겹치지 않는다
  4. 되돌아가는 화살표는 거터로 빠져나온 뒤 하단 링 레인을 탄다   → 같은 열 아래 노드를 관통하지 않는다
  5. 선을 전부 그린 뒤 라벨을, 그다음 노드를 그린다 + 라벨 뒤 헤일로 → 어떤 선도 글자를 덮지 않는다
  6. 라벨끼리 겹치면 세로로 밀어낸다
"""
from xml.sax.saxutils import escape

PAD_X, PAD_TOP = 34, 34
OVER_GAP, OVER_STEP = 42, 24
NODE_W, NODE_H, VGAP = 196, 68, 30
GUTTER = 132
RING_GAP, RING_STEP = 48, 28

ROLE = {
    "user":  ("#FFFFFF", "#5A6C7B", "#0F1B2A"),
    "svc":   ("#E1EDF4", "#1D4E6F", "#0F1B2A"),
    "media": ("#EAE5F5", "#5B4B8A", "#0F1B2A"),
    "ai":    ("#E4F2EB", "#2C7A5B", "#0F1B2A"),
    "store": ("#F8EFDD", "#A96F16", "#0F1B2A"),
    "ext":   ("#F1F4F6", "#8C9AA6", "#2E3A45"),
}
BG, SUB, LBL, EDGE = "#FFFFFF", "#4A5A6B", "#41525F", "#5A6C7B"
LSIZE = 11.5


def tw(s, px):
    return sum(px * (1.0 if ord(c) > 0x1100 else 0.55) for c in s)


class Diagram:
    def __init__(self, title, columns, edges, note=None, colw=None, nw=None, gut=None):
        self.NW, self.GUT = nw or NODE_W, gut or GUTTER
        self.title, self.note, self.colw = title, note, colw or {}
        self.cols, self.edges = columns, edges
        self.pos = {}
        self._place()
        self._route()

    # ---------- 배치 ----------
    def _place(self):
        self.body_h = max(
            (len([c for c in col if c]) * NODE_H + max(0, len([c for c in col if c]) - 1) * VGAP)
            for col in self.cols)
        x = PAD_X
        self.col_right = {}
        for ci, col in enumerate(self.cols):
            w = self.colw.get(ci, self.NW)
            items = [c for c in col if c]
            h = len(items) * NODE_H + max(0, len(items) - 1) * VGAP
            y = PAD_TOP + (self.body_h - h) / 2
            for nid, t, sub, role in items:
                self.pos[nid] = dict(x=x, y=y, w=w, h=NODE_H, cx=x + w / 2, cy=y + NODE_H / 2,
                                     col=ci, t=t, sub=sub, role=role)
                y += NODE_H + VGAP
            self.col_right[ci] = x + w
            x += w + self.GUT
        self.width = x - self.GUT + PAD_X

    # ---------- 라우팅 ----------
    def _route(self):
        self.segs, self.paths, self.labels = [], [], []
        rings = [e for e in self.edges if len(e) > 3 and e[3] == "ring"]
        rest = [e for e in self.edges if e not in rings]
        over = [e for e in rest if self.pos[e[1]]["col"] > self.pos[e[0]]["col"] + 1]
        norm = [e for e in rest if e not in over]
        self.over_h = (OVER_GAP + OVER_STEP * max(0, len(over) - 1) + 20) if over else 0
        if self.over_h:                       # 상단 레인 확보를 위해 본문을 내린다
            for p_ in self.pos.values():
                p_["y"] += self.over_h
                p_["cy"] += self.over_h

        outs, ins = {}, {}
        for e in norm:
            outs.setdefault(e[0], []).append(e)
        for e in norm + over:
            ins.setdefault(e[1], []).append(e)
        exit_y, entry_y = {}, {}
        for nid, es in outs.items():
            p = self.pos[nid]
            es.sort(key=lambda e: self.pos[e[1]]["cy"])
            for i, e in enumerate(es):
                exit_y[(e[0], e[1])] = p["y"] + p["h"] * (i + 1) / (len(es) + 1)
        for nid, es in ins.items():
            p = self.pos[nid]
            es.sort(key=lambda e: self.pos[e[0]]["cy"])
            for i, e in enumerate(es):
                entry_y[(e[0], e[1])] = p["y"] + p["h"] * (i + 1) / (len(es) + 1)

        # 출발 구간과 도착 구간이 같은 거터에서 같은 높이가 되면 두 선이 겹친다 — 살짝 밀어낸다
        for e1 in norm:
            for e2 in norm + over:
                if e1 is e2:
                    continue
                if (self.pos[e1[0]]["col"] == self.pos[e2[1]]["col"] - 1
                        and abs(exit_y[(e1[0], e1[1])] - entry_y[(e2[0], e2[1])]) < 2.5):
                    t_ = self.pos[e2[1]]
                    entry_y[(e2[0], e2[1])] = min(t_["y"] + t_["h"] - 8,
                                                  entry_y[(e2[0], e2[1])] + 6)

        gut = {}
        for e in norm:
            gut.setdefault(self.pos[e[0]]["col"], []).append(e)
        for e in over:                         # 목표 열 바로 왼쪽 거터에서 내려온다
            gut.setdefault(self.pos[e[1]]["col"] - 1, []).append(e)
        lane = {}
        for ci, es in gut.items():
            es.sort(key=lambda e: entry_y[(e[0], e[1])])
            base, step = self.col_right[ci], self.GUT / (len(es) + 1)
            for i, e in enumerate(es):
                lane[(e[0], e[1])] = base + step * (i + 1)

        self.ring_h = (RING_GAP + RING_STEP * max(0, len(rings) - 1) + 26) if rings else 0
        ring_y0 = PAD_TOP + self.over_h + self.body_h + RING_GAP

        for e in norm:
            k = (e[0], e[1])
            s, t = self.pos[e[0]], self.pos[e[1]]
            x1, y1 = s["x"] + s["w"], exit_y[k]
            x2, y2 = t["x"], entry_y[k]
            if abs(y1 - y2) < 0.6:
                self.paths.append(f'M{x1:.1f},{y1:.1f} H{x2-9:.1f}')
                self.segs.append(("h", y1, x1, x2))
                lab_x = (x1 + x2) / 2
            else:
                lx = lane[k]
                self.paths.append(f'M{x1:.1f},{y1:.1f} H{lx:.1f} V{y2:.1f} H{x2-9:.1f}')
                self.segs += [("h", y1, x1, lx), ("v", lx, min(y1, y2), max(y1, y2)),
                              ("h", y2, lx, x2)]
                lab_x = (lx + x2) / 2
            self.paths.append(("head", x2, y2))
            if e[2]:
                self.labels.append([lab_x, y2 - 12, e[2], y2])

        for i, e in enumerate(over):
            k = (e[0], e[1])
            s_, t_ = self.pos[e[0]], self.pos[e[1]]
            ly = PAD_TOP + OVER_GAP + OVER_STEP * i - OVER_GAP + 8 + OVER_STEP * 0
            ly = PAD_TOP + 8 + OVER_STEP * i
            sx = s_["x"] + s_["w"] * (i + 1) / (len(over) + 1)
            dx = lane[k]
            ey = entry_y[k]
            self.paths.append(f'M{sx:.1f},{s_["y"]:.1f} V{ly:.1f} H{dx:.1f} V{ey:.1f} H{t_["x"]-9:.1f}')
            self.segs += [("v", sx, ly, s_["y"]), ("h", ly, sx, dx),
                          ("v", dx, ly, ey), ("h", ey, dx, t_["x"])]
            self.paths.append(("head", t_["x"], ey))
            if e[2]:
                self.labels.append([(dx + t_["x"]) / 2, ey - 12, e[2], ey])

        for i, e in enumerate(rings):
            s, t = self.pos[e[0]], self.pos[e[1]]
            y = ring_y0 + RING_STEP * i
            sy = s["y"] + s["h"] * 0.78
            frac = 0.24 + 0.2 * i          # 되돌아가는 화살표마다 오르내리는 x 를 달리한다
            dx = self.col_right[s["col"]] + self.GUT * min(frac, 0.8)
            if t["col"] > 0:
                # 목표 열 왼쪽 거터에서 올라와 왼쪽으로 진입 — 같은 열 아래 노드를 관통하지 않는다
                ux = self.col_right[t["col"] - 1] + self.GUT * min(0.32 + 0.2 * i, 0.86)
                ey = t["y"] + t["h"] * 0.74
                self.paths.append(f'M{s["x"]+s["w"]:.1f},{sy:.1f} H{dx:.1f} V{y:.1f} '
                                  f'H{ux:.1f} V{ey:.1f} H{t["x"]-9:.1f}')
                self.segs += [("h", sy, s["x"] + s["w"], dx), ("v", dx, sy, y),
                              ("h", y, min(ux, dx), max(ux, dx)), ("v", ux, ey, y),
                              ("h", ey, ux, t["x"])]
                self.paths.append(("head", t["x"], ey))
                lab_x, lab_y = (dx + ux) / 2, y - 9
            else:
                ux = t["cx"]
                self.paths.append(f'M{s["x"]+s["w"]:.1f},{sy:.1f} H{dx:.1f} V{y:.1f} '
                                  f'H{ux:.1f} V{t["y"]+t["h"]+9:.1f}')
                self.segs += [("h", sy, s["x"] + s["w"], dx), ("v", dx, sy, y),
                              ("h", y, min(ux, dx), max(ux, dx)), ("v", ux, t["y"] + t["h"] + 9, y)]
                self.paths.append(("head_up", ux, t["y"] + t["h"]))
                lab_x, lab_y = (dx + ux) / 2, y - 9
            if e[2]:
                self.labels.append([lab_x, lab_y, e[2], lab_y])

        self._resolve_labels()
        self.height = (PAD_TOP + self.over_h + self.body_h + self.ring_h
                       + (32 + 20 * len(self.note) if self.note else 26))

    def _halo(self, l):
        w = tw(l[2], LSIZE) + 13
        return (l[0] - w / 2, l[1] - LSIZE * 0.92, w, LSIZE * 1.55)

    @staticmethod
    def _hit(r, seg):
        x, y, w, h = r
        if seg[0] == "h":
            sy, x1, x2 = seg[1], min(seg[2], seg[3]), max(seg[2], seg[3])
            return y < sy < y + h and x1 < x + w and x2 > x
        sx, y1, y2 = seg[1], min(seg[2], seg[3]), max(seg[2], seg[3])
        return x < sx < x + w and y1 < y + h and y2 > y

    @staticmethod
    def _ov(a, b):
        return (a[0] < b[0] + b[2] and b[0] < a[0] + a[2]
                and a[1] < b[1] + b[3] and b[1] < a[1] + a[3])

    def _resolve_labels(self):
        """라벨을 선·노드·다른 라벨과 겹치지 않는 자리로 옮긴다."""
        boxes = [(p["x"] - 4, p["y"] - 4, p["w"] + 8, p["h"] + 8) for p in self.pos.values()]
        offsets = [-12, -19, -26, -33, -40, -47, 15, 22, 29, 36, -54, -61]
        placed = []
        order = sorted(range(len(self.labels)), key=lambda i: self.labels[i][0])
        for i in order:
            lab = self.labels[i]
            base = lab[3]
            best, best_score = None, None
            for off in offsets:
                lab[1] = base + off
                h = self._halo(lab)
                score = (sum(1 for sg in self.segs if self._hit(h, sg))
                         + sum(1 for b in boxes if self._ov(h, b)) * 3
                         + sum(1 for q in placed if self._ov(h, q)) * 2)
                if score == 0:
                    best, best_score = off, 0
                    break
                if best_score is None or score < best_score:
                    best, best_score = off, score
            lab[1] = base + best
            placed.append(self._halo(lab))

    # ---------- 출력 ----------
    def svg(self):
        o = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {self.width:.0f} {self.height:.0f}" '
             f'width="{self.width:.0f}" height="{self.height:.0f}" role="img">',
             f'<title>{escape(self.title)}</title>',
             '<style>text{font-family:system-ui,-apple-system,"Segoe UI",Roboto,'
             '"Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",sans-serif}</style>',
             f'<rect width="100%" height="100%" fill="{BG}"/>']

        for p in self.paths:                                    # ① 선
            if isinstance(p, tuple):
                if p[0] == "head":
                    o.append(f'<path d="M{p[1]:.1f},{p[2]:.1f} l-9,-5 l0,10 z" fill="{EDGE}"/>')
                else:
                    o.append(f'<path d="M{p[1]:.1f},{p[2]:.1f} l-5,9 l10,0 z" fill="{EDGE}"/>')
            else:
                o.append(f'<path d="{p}" fill="none" stroke="{EDGE}" stroke-width="1.6"/>')

        self.halos = []
        for x, y, text, _base in self.labels:                          # ② 라벨 (헤일로 먼저)
            h = self._halo([x, y, text, _base])
            self.halos.append(h)
            o.append(f'<rect x="{h[0]:.1f}" y="{h[1]:.1f}" width="{h[2]:.1f}" '
                     f'height="{h[3]:.1f}" fill="{BG}" rx="2"/>')
            o.append(f'<text x="{x:.1f}" y="{y:.1f}" text-anchor="middle" font-size="{LSIZE}" '
                     f'fill="{LBL}" font-weight="500">{escape(text)}</text>')

        for nid, p in self.pos.items():                         # ③ 노드
            fill, stroke, tc = ROLE[p["role"]]
            o.append(f'<rect x="{p["x"]:.1f}" y="{p["y"]:.1f}" width="{p["w"]:.1f}" '
                     f'height="{p["h"]:.1f}" rx="3" fill="{fill}" stroke="{stroke}" stroke-width="1.8"/>')
            if p["sub"]:
                o.append(f'<text x="{p["cx"]:.1f}" y="{p["cy"]-3:.1f}" text-anchor="middle" '
                         f'font-size="14.5" font-weight="650" fill="{tc}">{escape(p["t"])}</text>')
                o.append(f'<text x="{p["cx"]:.1f}" y="{p["cy"]+16:.1f}" text-anchor="middle" '
                         f'font-size="11.5" fill="{SUB}">{escape(p["sub"])}</text>')
            else:
                o.append(f'<text x="{p["cx"]:.1f}" y="{p["cy"]+5:.1f}" text-anchor="middle" '
                         f'font-size="14.5" font-weight="650" fill="{tc}">{escape(p["t"])}</text>')

        if self.note:
            ny = PAD_TOP + self.over_h + self.body_h + self.ring_h + 32
            o.append(f'<line x1="{PAD_X}" y1="{ny-19:.1f}" x2="{self.width-PAD_X:.1f}" '
                     f'y2="{ny-19:.1f}" stroke="#E3E9ED"/>')
            for i, line in enumerate(self.note):
                o.append(f'<text x="{PAD_X}" y="{ny+i*20:.1f}" font-size="12" '
                         f'fill="{SUB}">{escape(line)}</text>')
        o.append('</svg>')
        return "\n".join(o)
