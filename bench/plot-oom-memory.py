#!/usr/bin/env python3
"""cgroup 0.5초 표본을 SVG 두 칸으로 그린다. 위는 총 메모리와 한계선, 아래는 익명 메모리.

**왜 Grafana 가 아닌가.** cAdvisor 값이 실제와 어긋난다. 같은 회차에서 cgroup 이 anon
731MB · current 1498MB 를 본 구간을 cAdvisor 는 rss 225MB · usage 888MB 로 보고했다.
스크레이프 간격 탓만이 아니다 — 800,000 회차는 23초 동안 anon 이 709MB 로 유지됐는데도
cAdvisor 최대가 225MB 였다. 그 값으로 그리면 곡선이 한계선 근처에도 안 가고, 그림이
캡션을 반박한다. JVM 힙은 앱 actuator 에서 바로 오므로 그쪽은 Grafana 를 쓴다.

**급등이 한 표본 안에서 일어난다.** 18.4초에 882MB 이던 총 메모리가 19.5초에 1498MB 로
튀고 20.1초에 30MB 가 된다(죽음). array_agg 가 uuid 100만 개를 한 값으로 모으고 INSERT 가
커밋되는 순간이다. 0.5초 표본에서도 한 점이라, 그 점을 표시하지 않으면 선이 얇아서 안 보인다.
표시는 측정한 점을 가리키는 것이지 그림을 꾸미는 것이 아니다.

사용법
  python3 bench/plot-oom-memory.py <일괄 csv> <조각 csv> [출력.svg]
"""
import csv
import sys

W, H = 1000, 520
PAD_L, PAD_R, PAD_T = 74, 96, 46
ROW_H, ROW_GAP, AXIS_H = 178, 46, 30

C_BATCH = "#C0392B"   # 일괄. 죽는 쪽
C_SLICE = "#2D6FD4"   # 조각 5,000
MB = 1048576


def load(path):
    rows = list(csv.DictReader(open(path, encoding="utf-8")))
    if not rows:
        raise SystemExit(f"표본이 없다: {path}")
    t0 = int(rows[0]["t_ms"])
    return [{
        "t": (int(r["t_ms"]) - t0) / 1000,
        "current": int(r["current"]) / MB,
        "anon": int(r["anon"]) / MB,
        "limit": int(r["limit"]) / MB,
    } for r in rows]


def main():
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    batch, slice_ = load(sys.argv[1]), load(sys.argv[2])
    out = sys.argv[3] if len(sys.argv) > 3 else "oom-memory.svg"
    limit = batch[0]["limit"]

    tmax = max(r["t"] for r in batch + slice_)
    plots = [
        ("총 메모리 (memory.current)", "current", max(limit * 1.07, max(r["current"] for r in batch + slice_) * 1.1), True),
        ("익명 메모리 (memory.stat anon)", "anon", max(r["anon"] for r in batch + slice_) * 1.15, False),
    ]

    def x(t):
        return PAD_L + (W - PAD_L - PAD_R) * t / tmax

    def y(v, top, ymax):
        return top + ROW_H - ROW_H * v / ymax

    p = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" role="img" '
         'aria-label="일괄 조회는 마지막 한 표본에서 총 메모리가 한도 %.0fMB에 닿고 프로세스가 '
         '종료된다. 조각 5,000은 익명 메모리가 40MB를 넘지 않는다." '
         'style="max-width:100%%;height:auto;font-family:inherit">'
         % (W, H, limit)]
    p.append('<style>text{fill:currentColor}.ax{stroke:currentColor;opacity:.28}'
             '.gr{stroke:currentColor;opacity:.10}.lb{font-size:12px}'
             '.tl{font-size:12.5px;font-weight:600}.sm{font-size:11px;opacity:.72}</style>')

    for i, (title, key, ymax, show_limit) in enumerate(plots):
        top = PAD_T + i * (ROW_H + ROW_GAP + AXIS_H)
        p.append('<text class="tl" x="%d" y="%d">%s</text>' % (PAD_L, top - 8, title))

        # 가로 눈금
        step = 500 if key == "current" else 200
        v = 0
        while v <= ymax:
            yy = y(v, top, ymax)
            p.append('<line class="gr" x1="%d" y1="%.1f" x2="%.1f" y2="%.1f"/>'
                     % (PAD_L, yy, W - PAD_R, yy))
            p.append('<text class="lb" x="%d" y="%.1f" text-anchor="end">%d</text>'
                     % (PAD_L - 8, yy + 4, v))
            v += step
        p.append('<text class="sm" x="%d" y="%.1f" text-anchor="end">MB</text>' % (PAD_L - 8, top - 8))

        if show_limit:
            yy = y(limit, top, ymax)
            p.append('<line x1="%d" y1="%.1f" x2="%.1f" y2="%.1f" stroke="%s" '
                     'stroke-width="1.6" stroke-dasharray="7 5" opacity=".85"/>'
                     % (PAD_L, yy, W - PAD_R, yy, C_BATCH))
            p.append('<text class="lb" x="%.1f" y="%.1f" fill="%s">한계 %.0fMB</text>'
                     % (W - PAD_R + 8, yy + 4, C_BATCH, limit))

        # x축
        ay = top + ROW_H
        p.append('<line class="ax" x1="%d" y1="%.1f" x2="%.1f" y2="%.1f"/>'
                 % (PAD_L, ay, W - PAD_R, ay))
        for t in range(0, int(tmax) + 1, 5):
            p.append('<line class="ax" x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f"/>'
                     % (x(t), ay, x(t), ay + 4))
            p.append('<text class="lb" x="%.1f" y="%.1f" text-anchor="middle">%d</text>'
                     % (x(t), ay + 18, t))
        p.append('<text class="sm" x="%.1f" y="%.1f">초</text>' % (W - PAD_R + 8, ay + 18))

        for rows, color in ((slice_, C_SLICE), (batch, C_BATCH)):
            d = " ".join(("M" if j == 0 else "L") + "%.1f %.1f" % (x(r["t"]), y(r[key], top, ymax))
                         for j, r in enumerate(rows))
            p.append('<path d="%s" fill="none" stroke="%s" stroke-width="2" '
                     'stroke-linejoin="round"/>' % (d, color))

        # 최고점은 한 표본 안에서 일어난다. 표시하지 않으면 선이 얇아 안 보인다.
        pk = max(batch, key=lambda r: r[key])
        px, py = x(pk["t"]), y(pk[key], top, ymax)
        p.append('<circle cx="%.1f" cy="%.1f" r="4" fill="%s"/>' % (px, py, C_BATCH))
        p.append('<text class="lb" x="%.1f" y="%.1f" text-anchor="end" fill="%s">%.0fMB · %.1f초</text>'
                 % (px - 9, py + 4, C_BATCH, pk[key], pk["t"]))

    # 범례는 맨 위 한 줄에 가로로 둔다. 오른쪽에 두면 한계선 표시와 겹치고 잘린다.
    lx = PAD_L
    for label, color in (("조각 1,100,000", C_BATCH), ("조각 5,000", C_SLICE)):
        p.append('<line x1="%.1f" y1="14" x2="%.1f" y2="14" stroke="%s" stroke-width="2.6"/>'
                 % (lx, lx + 22, color))
        p.append('<text class="lb" x="%.1f" y="18">%s</text>' % (lx + 28, label))
        lx += 34 + len(label) * 7.4

    p.append("</svg>")
    open(out, "w", encoding="utf-8").write("\n".join(p) + "\n")
    print("  %s" % out)
    for name, rows in (("일괄", batch), ("조각 5,000", slice_)):
        pk = max(rows, key=lambda r: r["current"])
        pa = max(rows, key=lambda r: r["anon"])
        print("    %-12s 총 최대 %6.0fMB (%.1f초)   익명 최대 %6.0fMB (%.1f초)"
              % (name, pk["current"], pk["t"], pa["anon"], pa["t"]))


if __name__ == "__main__":
    main()
