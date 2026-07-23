# -*- coding: utf-8 -*-
"""레이아웃 불변식 검증: 선이 상자를 관통하는가 / 선이 글자를 덮는가 / 선끼리 겹치는가."""
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
    for i, a in enumerate(d.segs):
        for b in d.segs[i+1:]:
            if a[0] == b[0] == "h" and abs(a[1]-b[1]) < 1.5 and \
               min(a[2],a[3]) < max(b[2],b[3])-2 and max(a[2],a[3]) > min(b[2],b[3])+2:
                issues.append(f"수평선 중첩: {a} / {b}")
            if a[0] == b[0] == "v" and abs(a[1]-b[1]) < 1.5 and \
               min(a[2],a[3]) < max(b[2],b[3])-2 and max(a[2],a[3]) > min(b[2],b[3])+2:
                issues.append(f"수직선 중첩: {a} / {b}")
    return issues
