# -*- coding: utf-8 -*-
"""pitch/*.svg 를 한 페이지로 묶는다. build_deck.py · build_arch.py 를 먼저 돌린 뒤 실행한다."""
import pathlib
import re
import sys

sys.path.insert(0, ".")
import build_deck as BD
import build_arch as BA
import build_full as BF

TITLES = {n: d.title for d, n in zip(BD.DECK, BD.NAMES)}
TITLES.update({n: d.title for n, d in BA.PLATES})
TITLES["full-architecture"] = BF.FULL.title

USE = {
    "full-architecture": "서비스 전체를 한 장에 — 클라이언트부터 외부 모델까지",
    "00-overview":       "제품 전체를 한 장으로 — 첫 슬라이드",
    "01-authoring":      "강사가 강의를 만들어 공개하기까지",
    "02-enrollment":     "학생이 강의를 찾아 듣기 시작하기까지",
    "03-live":           "수업이 실제로 진행되는 순간",
    "04-captions":       "말이 자막이 되는 과정 — 제품의 차별점",
    "05-materials":      "올린 자료가 검색 가능한 지식이 되는 과정",
    "06-qa":             "질문에 근거를 달아 답하는 방식",
    "07-replay":         "지난 수업을 다시 보는 방식",
    "08-data":           "데이터를 어떻게 나눠 두었는가",
    "09-servers":        "실제로 어떤 서버에 어떻게 얹었는가",
    "10-backend-modules": "백엔드 안이 어떻게 나뉘어 있는가",
    "11-request-path":   "요청 하나가 어떤 검사를 거치는가",
    "12-architecture":   "구성 요소 전부를 세 플레인으로 — 기술 발표의 중심 슬라이드",
    "13-trust":          "백엔드를 우회하는 경로가 안전한 이유",
    "14-service-app":    "앱 서비스 안에서 요청이 지나는 순서와 모듈 구성",
    "15-service-media":  "미디어 서비스의 실시간 경로와 녹화 경로",
    "16-service-ai":     "AI 서비스의 실시간 자막 경로와 배치 처리 경로",
}
ORDER = ["full-architecture", "00-overview", "01-authoring", "02-enrollment", "03-live", "04-captions",
         "05-materials", "06-qa", "07-replay",
         "12-architecture", "14-service-app", "15-service-media", "16-service-ai",
         "10-backend-modules", "11-request-path", "08-data", "09-servers", "13-trust"]
GROUP = {
    "full-architecture": "전체 — 한 장으로 보는 서비스",
    "00-overview": "제품 이야기 — 발표 본문",
    "12-architecture": "서비스 구성 — 기술 발표 본문",
    "10-backend-modules": "세부 — 질문이 나오면 꺼내는 장",
}

HEAD = '''<title>LiveClass AI — 아키텍처</title>
<style>
  :root{--bg:#F2F4F6;--ink:#0F1B2A;--soft:#4A5A6B;--faint:#7C8B99;--rule:#DCE3E8}
  @media (prefers-color-scheme:dark){:root{--bg:#0C1218;--ink:#E4EBF1;--soft:#9DAEBC;--faint:#71828F;--rule:#1F2B36}}
  :root[data-theme="dark"]{--bg:#0C1218;--ink:#E4EBF1;--soft:#9DAEBC;--faint:#71828F;--rule:#1F2B36}
  :root[data-theme="light"]{--bg:#F2F4F6;--ink:#0F1B2A;--soft:#4A5A6B;--faint:#7C8B99;--rule:#DCE3E8}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);line-height:1.6;
       font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",sans-serif}
  .wrap{max-width:78rem;margin:0 auto;padding:0 1.5rem 5rem}
  header{padding:3.5rem 0 1.75rem;border-bottom:2px solid var(--ink);display:flex;flex-direction:column;gap:.85rem}
  .eb{font-size:.72rem;letter-spacing:.16em;text-transform:uppercase;color:var(--faint)}
  h1{margin:0;font-size:clamp(1.9rem,4.6vw,2.9rem);letter-spacing:-.03em;line-height:1.05;font-weight:700;text-wrap:balance}
  header p{margin:0;max-width:62ch;color:var(--soft)}
  .legend{display:flex;flex-wrap:wrap;gap:.5rem 1.4rem;margin-top:.4rem;font-size:.8rem;color:var(--soft)}
  .legend span{display:inline-flex;align-items:center;gap:.45rem}
  .sw{width:.85rem;height:.85rem;border-radius:2px;border:1.6px solid}
  .grp{margin:3rem 0 .25rem;font-size:.76rem;letter-spacing:.14em;text-transform:uppercase;color:var(--faint);font-weight:600}
  .plate{margin:1.1rem 0 0;background:#FFFFFF;border:1px solid var(--rule);border-radius:2px;overflow:hidden;box-shadow:0 1px 2px rgba(15,27,42,.05)}
  .ph{padding:1.2rem 1.4rem .95rem;border-bottom:1px solid #EDF1F4;display:grid;grid-template-columns:auto 1fr;gap:.15rem .9rem;align-items:baseline}
  .pn{grid-row:1/3;font-size:1.5rem;font-weight:700;color:#1D4E6F;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
  .ph h2{margin:0;font-size:1.22rem;letter-spacing:-.02em;font-weight:650;color:#0F1B2A}
  .ph p{margin:0;font-size:.86rem;color:#5A6C7B}
  .pc{padding:1.1rem;overflow-x:auto;background:#FFFFFF}
  .dg{display:block;width:100%;height:auto;min-width:660px}
  footer{margin-top:3rem;padding-top:1.2rem;border-top:2px solid var(--ink);font-size:.75rem;color:var(--faint);display:flex;flex-wrap:wrap;gap:.4rem 1.5rem;justify-content:space-between}
</style>
<div class="wrap">
  <header>
    <div class="eb">LiveClass AI · 아키텍처 · 2026-07-23</div>
    <h1>실시간 라이브 강의 플랫폼</h1>
    <p>앞의 여덟 장이 제품 이야기 순서 그대로다. 가운데 네 장은 서비스 구성 —
       전체를 세 플레인으로 보고, 이어서 서비스 안을 하나씩 연다. 나머지는 질문이 나올 때 꺼낸다.
       색은 진행 상태가 아니라 역할을 뜻한다.</p>
    <div class="legend">
      <span><i class="sw" style="background:#FFFFFF;border-color:#5A6C7B"></i>사용자</span>
      <span><i class="sw" style="background:#E1EDF4;border-color:#1D4E6F"></i>서비스</span>
      <span><i class="sw" style="background:#EAE5F5;border-color:#5B4B8A"></i>미디어</span>
      <span><i class="sw" style="background:#E4F2EB;border-color:#2C7A5B"></i>AI</span>
      <span><i class="sw" style="background:#F8EFDD;border-color:#A96F16"></i>저장소</span>
      <span><i class="sw" style="background:#F1F4F6;border-color:#8C9AA6"></i>외부</span>
    </div>
  </header>
'''

if __name__ == "__main__":
    cards = []
    for n in ORDER:
        if n in GROUP:
            cards.append(f'  <h3 class="grp">{GROUP[n]}</h3>')
        svg = pathlib.Path(f"../pitch/{n}.svg").read_text(encoding="utf-8")
        svg = re.sub(r'<svg([^>]*?)width="[\d.]+" height="[\d.]+"', r'<svg\1', svg, count=1)
        svg = svg.replace('<svg ', '<svg class="dg" preserveAspectRatio="xMidYMid meet" ', 1)
        cards.append(f'''  <figure class="plate" id="{n}">
    <div class="ph"><span class="pn">{n[:2]}</span><h2>{TITLES[n]}</h2><p>{USE[n]}</p></div>
    <div class="pc">{svg}</div>
  </figure>''')
    pathlib.Path("../pitch/index.html").write_text(
        HEAD + "\n".join(cards) +
        '\n  <footer><span>LiveClass AI — 아키텍처</span>'
        '<span>정본: docs/ARCHITECTURE.md · 생성: tools/build_deck.py · build_arch.py</span></footer>\n</div>\n',
        encoding="utf-8")
    print(f"갤러리 {len(ORDER)}장 생성")
