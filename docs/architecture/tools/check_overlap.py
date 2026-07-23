# -*- coding: utf-8 -*-
"""레이아웃 불변식 검증.

선이 상자를 관통 / 선끼리 겹침 / 라벨끼리 겹침 / 라벨이 노드·구역 제목을 덮음.
마지막 항목이 오래 빠져 있었다 — 라벨은 헤일로로 선은 가리지만 글자끼리는 서로 못 가린다.
"""

def _tw(s, px):
    return sum(px * (1.0 if ord(c) > 0x1100 else 0.55) for c in s)


def zone_title_boxes(d):
    """구역 제목(accent 바 + 굵은 글자)이 차지하는 영역."""
    out = []
    for z in getattr(d, "zones", []):
        lab, zx, zy = z[0], z[1], z[2]
        w = 12 + _tw(lab, 13) + 1.6 * len(lab) + 10
        out.append((zx + 12, zy + 8, w, 20, f"구역제목 '{lab}'"))
    return out
def rects_overlap(a, b, pad=0):
    ax, ay, aw, ah = a; bx, by, bw, bh = b
    return not (ax+aw <= bx-pad or bx+bw <= ax-pad or ay+ah <= by-pad or by+bh <= ay-pad)

def seg_rect_hit(seg, r, pad=2):
    x, y, w, h = r
    if seg[0] == "h":
        sy, x1, x2 = seg[1], min(seg[2], seg[3]), max(seg[2], seg[3])
        return y+pad < sy < y+h-pad and x1 < x+w-pad and x2 > x+pad
    sx, y1, y2 = seg[1], min(seg[2], seg[3]), max(seg[2], seg[3])
    return x+pad < sx < x+w-pad and y1 < y+h-pad and y2 > y+pad

def check(d):
    issues = []
    boxes = [(p["x"], p["y"], p["w"], p["h"], nid) for nid, p in d.pos.items()]
    lg = getattr(d, "legend", None)
    if lg:
        boxes.append((lg[0], lg[1], lg[2], lg[3], "범례"))
    for seg in d.segs:
        for x, y, w, h, nid in boxes:
            if seg_rect_hit(seg, (x, y, w, h)):
                issues.append(f"선이 노드 '{nid}' 를 관통: {seg}")
    # 라벨 아래를 지나는 선은 헤일로가 가리므로 결함이 아니다 — 참고 수치로만 센다
    d.under = sum(1 for seg in d.segs for h in d.halos if seg_rect_hit(seg, h, pad=0))
    for i in range(len(d.halos)):
        for j in range(i+1, len(d.halos)):
            if rects_overlap(d.halos[i], d.halos[j]):
                issues.append(f"라벨끼리 겹침: {i}·{j}")
    labels = getattr(d, "labels", [])
    for i, h in enumerate(d.halos):
        txt = labels[i][2] if i < len(labels) else f"#{i}"
        for x, y, w, hh, nid in boxes:
            if rects_overlap(h, (x, y, w, hh)):
                issues.append(f"라벨 '{txt}' 이 노드 '{nid}' 를 덮음")
        for zx, zy, zw, zh, zname in zone_title_boxes(d):
            if rects_overlap(h, (zx, zy, zw, zh)):
                issues.append(f"라벨 '{txt}' 이 {zname} 을 덮음")
    for x, y, w, hh, nid in boxes:
        for zx, zy, zw, zh, zname in zone_title_boxes(d):
            if rects_overlap((x, y, w, hh), (zx, zy, zw, zh)):
                issues.append(f"노드 '{nid}' 가 {zname} 을 덮음")
    for i, a in enumerate(d.segs):
        for b in d.segs[i+1:]:
            if a[0] == b[0] == "h" and abs(a[1]-b[1]) < 1.5 and \
               min(a[2],a[3]) < max(b[2],b[3])-2 and max(a[2],a[3]) > min(b[2],b[3])+2:
                issues.append(f"수평선 중첩: {a} / {b}")
            if a[0] == b[0] == "v" and abs(a[1]-b[1]) < 1.5 and \
               min(a[2],a[3]) < max(b[2],b[3])-2 and max(a[2],a[3]) > min(b[2],b[3])+2:
                issues.append(f"수직선 중첩: {a} / {b}")
    return issues
