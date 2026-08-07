#!/usr/bin/env python3
"""OpenAPI 스냅샷 → 정적 API 레퍼런스(HTML + Markdown).

운영에는 Swagger UI가 **열려 있지 않다**. nginx가 백엔드로 넘기는 경로는 `/api/`뿐인데
springdoc은 `/swagger-ui/**`·`/v3/api-docs`에 붙어 있어, 밖에서 그 주소를 치면 SPA
index.html이 돌아온다. 그렇다고 그 경로를 뚫으면 `SecurityConfig`가 이미 permitAll이라
내부 API 표면이 통째로 공개된다. 그래서 **스펙을 떠서 정적 문서로 굽는다** — 서버를
열지 않고도 같은 것을 본다.

입력은 기본적으로 옆의 `openapi.json` 스냅샷이다. 다시 뜨려면:

    docker exec liveclass-backend-prod wget -qO- http://localhost:8080/v3/api-docs \\
        > docs/api/openapi.json
    python3 docs/api/tools/build_api_reference.py

로컬 백엔드가 떠 있으면 `--from-url http://localhost:8080/v3/api-docs`로 바로 받는다.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE.parent                       # docs/api — 스펙 스냅샷·Markdown
ROOT = HERE.parents[2]                      # 저장소 루트
# 화면은 **프론트 정적 자산으로** 나간다. Vite가 public/ 을 dist/ 로 그대로 복사하고
# nginx의 SPA fallback(`try_files $uri $uri/ /index.html`)이 실제 파일을 먼저 집으므로,
# 배포하면 `https://<도메인>/api-docs/` 로 열린다. 서버 코드도 프록시 규칙도 건드리지 않는다.
# (`/api-docs` 는 `/api/` 로 시작하지 않아 백엔드 프록시 location 과 겹치지 않는다.)
HTML_OUT = ROOT / "frontend" / "public" / "api-docs" / "index.html"

METHODS = ("get", "post", "put", "patch", "delete", "head", "options")

# Swagger UI 색 규약을 그대로 쓴다 — 보는 사람이 이미 아는 색이다.
METHOD_COLOR = {
    "get": "#61AFFE",
    "post": "#49CC90",
    "put": "#FCA130",
    "patch": "#50E3C2",
    "delete": "#F93E3E",
    "head": "#9012FE",
    "options": "#0D5AA7",
}

# ---------------------------------------------------------------------------
# 접근 권한 — SecurityConfig.java 의 authorizeHttpRequests 체인을 그대로 옮긴 것.
#
# Swagger는 이걸 못 보여준다(springdoc은 시큐리티 체인을 읽지 않는다). 그런데 이 API를
# 처음 보는 사람이 가장 먼저 묻는 게 "이거 로그인 없이 되나"다. 그래서 여기서 계산해 붙인다.
#
# **SecurityConfig.java 를 고치면 이 표도 같이 고친다.** 순서가 의미를 갖는다 — 먼저
# 맞는 규칙이 이긴다(Spring Security 와 같다).
# ---------------------------------------------------------------------------
AUTH_RULES: list[tuple[str | None, tuple[str, ...], str, str]] = [
    # (HTTP 메서드 | None=전부, 경로 Ant 패턴들, 배지 키, 한 줄 근거)
    ("GET", ("/api/auth/csrf", "/api/auth/email-availability"), "public",
     "로그인 전에 불러야 한다"),
    ("POST", ("/api/auth/signup", "/api/auth/login", "/api/auth/logout"), "public",
     "로그인 전에 불러야 한다"),
    ("POST", ("/api/webhooks/livekit",), "signed",
     "LiveKit이 서명한 JWT를 컨트롤러가 검증한다"),
    ("POST", ("/api/internal/ai/callbacks", "/api/internal/ai/materials/download-url"), "signed",
     "AI 워커 HMAC 서명(ADR-0036)"),
    (None, ("/api/internal/ai/recorded-stt-jobs/**",), "signed",
     "batch STT 워커 전용 HMAC(ADR-0011)"),
    ("POST", ("/api/internal/ai/recorded-stt-callbacks",), "signed",
     "batch STT 워커 전용 HMAC(ADR-0011)"),
    ("POST", ("/api/internal/media/**",), "signed",
     "media-worker 용도별 HMAC(ADR-0008)"),
    ("GET", ("/api/live-sessions/*/annotation",), "signed",
     "세션 쿠키가 없으면 LiveKit 토큰 서명을 본다(ADR-0055)"),
    ("GET", ("/api/annotation-interpret-images/*",), "signed",
     "128비트 난수 토큰이 곧 자격, 짧은 TTL(ADR-0058)"),
    ("GET", ("/api/curriculums/*/materials/*/download",
             "/api/lessons/*/materials/*/download"), "student",
     "자료 다운로드는 공개 상세보다 먼저 학생 역할을 요구한다"),
    ("GET", ("/api/curriculums", "/api/curriculums/**"), "public",
     "공개 카탈로그 — 비로그인 GET 허용"),
    ("POST", ("/api/curriculums/*/enrollments",), "student", "수강 신청은 학생만"),
    ("DELETE", ("/api/curriculums/*/enrollments/me",), "student", "수강 취소는 학생만"),
    (None, ("/api/instructor/**",), "instructor",
     "소유권(내 커리큘럼인가)은 서비스가 따로 본다"),
    (None, ("/api/admin/**",), "admin",
     "ADMIN은 security.admin-emails allowlist 오버레이"),
    (None, ("/api/assets/**",), "auth", "익명 발급 금지 — kind별 권한은 컨트롤러가 판정"),
]

AUTH_BADGE = {
    "public": ("공개", "#0F9D58", "인증 없이 호출된다"),
    "signed": ("서명", "#B8860B", "로그인 세션이 아니라 서명·토큰으로 인증한다(서버 간)"),
    "auth": ("로그인", "#4285F4", "세션 쿠키 필요"),
    "student": ("STUDENT", "#7B1FA2", "학생 역할 필요"),
    "instructor": ("INSTRUCTOR", "#C2185B", "강사 역할 필요"),
    "admin": ("ADMIN", "#D32F2F", "관리자 역할 필요"),
}


def ant_to_regex(pattern: str) -> re.Pattern[str]:
    """Ant 경로 패턴을 정규식으로. `**`는 나머지 전부, `*`는 세그먼트 하나."""
    out = ["^"]
    i = 0
    while i < len(pattern):
        if pattern.startswith("**", i):
            out.append(".*")
            i += 2
        elif pattern[i] == "*":
            out.append("[^/]*")
            i += 1
        else:
            out.append(re.escape(pattern[i]))
            i += 1
    out.append("$")
    return re.compile("".join(out))


AUTH_COMPILED = [
    (method, [ant_to_regex(p) for p in patterns], badge, why)
    for method, patterns, badge, why in AUTH_RULES
]


def resolve_auth(path: str, method: str) -> tuple[str, str]:
    """OpenAPI 경로 + 메서드 → (배지 키, 근거). 못 맞으면 anyRequest().authenticated()."""
    # `/api/x/{id}/y` 의 `{id}` 는 실제 값이 들어갈 자리다 — 세그먼트 하나로 본다.
    concrete = re.sub(r"\{[^}]+\}", "\x00", path)
    for rule_method, regexes, badge, why in AUTH_COMPILED:
        if rule_method and rule_method != method.upper():
            continue
        for rx in regexes:
            # 패턴 쪽 `*` 는 [^/]* 이므로 자리표시자 \x00 도 그대로 먹는다.
            if rx.match(concrete):
                return badge, why
    return "auth", "anyRequest().authenticated()"


# ---------------------------------------------------------------------------
# 스키마 렌더
# ---------------------------------------------------------------------------

def ref_name(schema: dict) -> str | None:
    ref = schema.get("$ref")
    if not ref:
        return None
    return ref.rsplit("/", 1)[-1]


def type_label(schema: dict) -> str:
    """`string(uuid)` · `array<Foo>` 처럼 한 줄로 읽히는 타입 표기."""
    name = ref_name(schema)
    if name:
        return name
    t = schema.get("type")
    if isinstance(t, list):  # OpenAPI 3.1 의 nullable 표기
        parts = [x for x in t if x != "null"]
        t = parts[0] if parts else "null"
    if t == "array":
        return f"array&lt;{type_label(schema.get('items', {}))}&gt;"
    if not t:
        for key in ("allOf", "oneOf", "anyOf"):
            if key in schema and schema[key]:
                return type_label(schema[key][0])
        return "object"
    fmt = schema.get("format")
    return f"{t}({fmt})" if fmt else t


def render_schema(schema: dict, schemas: dict, depth: int = 0,
                  seen: frozenset[str] = frozenset()) -> str:
    """스키마 하나를 접히는 트리로. 순환은 이름 링크에서 끊는다."""
    if not schema:
        return '<div class="muted">(본문 없음)</div>'

    name = ref_name(schema)
    if name:
        link = f'<a class="model-link" href="#model-{html.escape(name)}">{html.escape(name)}</a>'
        if name in seen or depth >= 3 or name not in schemas:
            return f'<div class="stype">{link}</div>'
        inner = render_schema(schemas[name], schemas, depth + 1, seen | {name})
        return f'<div class="stype">{link}</div>{inner}'

    t = schema.get("type")
    if isinstance(t, list):
        t = next((x for x in t if x != "null"), None)

    if t == "array":
        items = schema.get("items", {})
        return ('<div class="sarr">배열 · 원소:</div>'
                f'<div class="sindent">{render_schema(items, schemas, depth, seen)}</div>')

    props = schema.get("properties")
    if props:
        required = set(schema.get("required", []))
        rows = []
        for key, val in props.items():
            desc = val.get("description", "")
            enum = val.get("enum")
            child = ""
            if ref_name(val) or val.get("properties") or val.get("type") == "array":
                child = (f'<div class="sindent">'
                         f'{render_schema(val, schemas, depth + 1, seen)}</div>')
            rows.append(
                '<div class="prow">'
                f'<code class="pname">{html.escape(key)}</code>'
                f'<span class="ptype">{type_label(val)}</span>'
                + ('<span class="req">필수</span>' if key in required else "")
                + (f'<span class="pdesc">{html.escape(desc)}</span>' if desc else "")
                + (f'<div class="penum">{" · ".join(html.escape(str(e)) for e in enum)}</div>'
                   if enum else "")
                + child
                + "</div>")
        return f'<div class="props">{"".join(rows)}</div>'

    if schema.get("enum"):
        vals = " · ".join(html.escape(str(e)) for e in schema["enum"])
        return f'<div class="stype">{type_label(schema)}<span class="penum">{vals}</span></div>'

    return f'<div class="stype">{type_label(schema)}</div>'


def body_schema(container: dict) -> dict:
    """requestBody/response 의 content 에서 스키마 하나를 고른다."""
    content = container.get("content") or {}
    for media in ("application/json", "*/*", "text/event-stream"):
        if media in content:
            return content[media].get("schema", {})
    for val in content.values():
        return val.get("schema", {})
    return {}


def media_types(container: dict) -> list[str]:
    return sorted((container.get("content") or {}).keys())


# ---------------------------------------------------------------------------
# 수집
# ---------------------------------------------------------------------------

def collect(spec: dict) -> list[dict]:
    ops = []
    for path, item in spec.get("paths", {}).items():
        for method in METHODS:
            op = item.get(method)
            if not op:
                continue
            tags = op.get("tags") or ["(태그 없음)"]
            badge, why = resolve_auth(path, method)
            ops.append({
                "path": path, "method": method, "op": op,
                "tag": tags[0], "auth": badge, "auth_why": why,
                "anchor": "op-" + re.sub(r"[^a-zA-Z0-9]+", "-",
                                         f"{method}-{path}").strip("-").lower(),
            })
    return ops


def group_by_tag(ops: list[dict], spec: dict) -> list[tuple[str, str, list[dict]]]:
    """태그 순서는 스펙의 tags 선언을 따르고, 선언에 없는 건 뒤에 붙인다."""
    declared, desc = [], {}
    for t in spec.get("tags", []):
        n = t.get("name")
        if n and n not in declared:
            declared.append(n)
            desc[n] = t.get("description", "")
    present = {o["tag"] for o in ops}
    order = [t for t in declared if t in present]
    order += sorted(present - set(order))
    return [(t, desc.get(t, ""), [o for o in ops if o["tag"] == t]) for t in order]


# ---------------------------------------------------------------------------
# HTML
# ---------------------------------------------------------------------------

CSS = """
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin:0; background:#FAFAFA; color:#3B4151;
       font-family:'Noto Sans KR',Pretendard,system-ui,sans-serif; font-size:14px; line-height:1.6; }
code, .mono { font-family:'D2Coding','JetBrains Mono',Menlo,Consolas,monospace; }
header { background:#1B1B1B; color:#fff; padding:26px 32px; }
header h1 { margin:0 0 6px; font-size:24px; }
header .sub { color:#B9BFC7; font-size:13px; }
.wrap { max-width:1180px; margin:0 auto; padding:0 24px 100px; }
.notice { background:#FFF8E1; border:1px solid #FFE082; border-radius:8px;
          padding:14px 18px; margin:24px 0; font-size:13.5px; }
.notice b { color:#8D6E00; }
.meta { display:flex; flex-wrap:wrap; gap:10px; margin:20px 0 8px; }
.meta div { background:#fff; border:1px solid #E4E7EB; border-radius:8px; padding:8px 14px; font-size:13px; }
.meta strong { display:block; font-size:19px; color:#1B1B1B; }
.legend { display:flex; flex-wrap:wrap; gap:8px; margin:14px 0 26px; font-size:12.5px; }
.legend span { border-radius:20px; padding:3px 11px; color:#fff; font-weight:700; }
.legend em { font-style:normal; color:#6B7785; margin-right:14px; }
#filter { width:100%; padding:11px 14px; font-size:14px; border:1px solid #D5DAE0;
          border-radius:8px; margin:8px 0 26px; }
h2.tag { font-size:20px; margin:34px 0 4px; padding-bottom:8px; border-bottom:1px solid #E4E7EB; }
h2.tag .count { font-size:13px; color:#8792A2; font-weight:400; margin-left:8px; }
.tagdesc { color:#6B7785; margin:0 0 12px; font-size:13px; }
details.op { border:1px solid; border-radius:6px; margin:0 0 6px; overflow:hidden; }
details.op > summary { display:flex; align-items:center; gap:12px; padding:8px 12px;
                       cursor:pointer; list-style:none; }
details.op > summary::-webkit-details-marker { display:none; }
.verb { flex:none; min-width:74px; text-align:center; border-radius:4px; color:#fff;
        font-weight:700; font-size:12px; padding:5px 0; letter-spacing:.3px; }
.route { font-family:'D2Coding','JetBrains Mono',Menlo,monospace; font-weight:600; font-size:13.5px; }
.route .pp { color:#8792A2; }
.opsum { color:#5B6673; font-size:13px; flex:1; }
.auth { flex:none; border-radius:20px; padding:2px 10px; color:#fff; font-size:11px; font-weight:700; }
.body { padding:14px 16px 18px; background:#fff; border-top:1px solid rgba(0,0,0,.08); }
.desc { margin:0 0 14px; white-space:pre-wrap; }
h4 { margin:16px 0 6px; font-size:12px; letter-spacing:.6px; color:#8792A2; text-transform:uppercase; }
table.params { width:100%; border-collapse:collapse; font-size:13px; }
table.params th { text-align:left; color:#8792A2; font-weight:600; font-size:11.5px;
                  border-bottom:1px solid #E4E7EB; padding:5px 8px; }
table.params td { border-bottom:1px solid #F0F2F4; padding:6px 8px; vertical-align:top; }
.props { margin:2px 0; }
.prow { padding:3px 0 3px 10px; border-left:2px solid #EDF0F3; }
.pname { font-weight:600; color:#1B1B1B; }
.ptype { color:#8792A2; margin-left:8px; font-size:12.5px; }
.req { color:#C2185B; font-size:11px; margin-left:8px; font-weight:700; }
.pdesc { color:#5B6673; margin-left:10px; font-size:12.5px; }
.penum { color:#0F766E; font-size:12px; margin-left:10px; }
.sindent { margin-left:14px; }
.stype, .sarr { color:#5B6673; font-size:12.5px; }
.model-link { color:#1565C0; text-decoration:none; font-weight:600; }
.model-link:hover { text-decoration:underline; }
.muted { color:#98A2B3; font-size:12.5px; }
.resp { display:flex; gap:12px; padding:6px 0; border-bottom:1px solid #F0F2F4; }
.code { flex:none; font-weight:700; min-width:44px; }
.c2 { color:#0F9D58; } .c4 { color:#E65100; } .c5 { color:#C62828; }
.why { color:#8792A2; font-size:12px; margin-top:10px; }
h2.models { font-size:20px; margin:46px 0 12px; padding-bottom:8px; border-bottom:1px solid #E4E7EB; }
details.model { border:1px solid #E4E7EB; border-radius:6px; margin-bottom:5px; background:#fff; }
details.model > summary { padding:8px 12px; cursor:pointer; font-weight:600; }
details.model .body { border-top:1px solid #E4E7EB; }
.hidden { display:none !important; }

/* 인쇄(Ctrl+P → PDF). 글자가 잘리지 않게 세 가지를 푼다:
   1) `overflow:hidden` — 화면에선 둥근 모서리용이지만 페이지 경계에서 내용을 먹는다.
   2) 고정 폭/한 줄 배치 — 긴 경로와 긴 요약이 서로를 밀어낸다. 두 줄로 쌓는다.
   3) 접힌 details — 아래 JS가 인쇄 직전에 전부 펼친다.
   색 칩은 그대로 살린다(print-color-adjust). */
@media print {
  @page { size: A4; margin: 12mm 10mm 14mm; }
  body { background:#fff; font-size:9.5pt; -webkit-print-color-adjust:exact;
         print-color-adjust:exact; }
  * { overflow-wrap:anywhere; }
  header { background:#fff; color:#17324D; padding:0 0 10pt; border-bottom:2px solid #242A31; }
  header .sub { color:#5B6673; }
  .wrap { max-width:none; padding:0; }
  #filter, .legend em { display:none; }
  details.op, details.model { overflow:visible; break-inside:avoid; }
  details.op > summary, details.model > summary { display:block; }
  details.op > summary .verb { display:inline-block; min-width:52pt; }
  details.op > summary .route { display:inline; }
  details.op > summary .opsum { display:block; margin-top:2pt; }
  details.op > summary .auth { float:right; }
  h2.tag { break-before:page; break-after:avoid; }
  h2.models { break-before:page; break-after:avoid; }
  h4, .tagdesc { break-after:avoid; }
  .prow, .resp { break-inside:avoid; }
  .model-link { color:#15559A; }
}
"""

JS = """
const q = document.getElementById('filter');
q.addEventListener('input', () => {
  const t = q.value.trim().toLowerCase();
  document.querySelectorAll('details.op').forEach(el => {
    el.classList.toggle('hidden', t && !el.dataset.search.includes(t));
  });
  document.querySelectorAll('section.taggroup').forEach(sec => {
    const any = sec.querySelectorAll('details.op:not(.hidden)').length > 0;
    sec.classList.toggle('hidden', !any);
  });
});
// 모델 링크를 누르면 접혀 있는 모델을 펴 준다 — 안 그러면 앵커만 맞고 내용이 안 보인다.
document.addEventListener('click', e => {
  const a = e.target.closest('a.model-link');
  if (!a) return;
  const el = document.querySelector(a.getAttribute('href'));
  if (el && el.tagName === 'DETAILS') el.open = true;
});
// 인쇄(Ctrl+P → PDF)에는 접힌 것이 안 보인다. 찍기 직전에 전부 펴고, 끝나면 되돌린다.
let printRestore = [];
addEventListener('beforeprint', () => {
  printRestore = [...document.querySelectorAll('details')].filter(d => !d.open);
  printRestore.forEach(d => d.open = true);
  document.querySelectorAll('.hidden').forEach(el => el.classList.remove('hidden'));
});
addEventListener('afterprint', () => {
  printRestore.forEach(d => d.open = false);
  printRestore = [];
});
"""


def esc(s: str) -> str:
    return html.escape(s or "")


def render_route(path: str) -> str:
    return re.sub(r"\{([^}]+)\}", r'<span class="pp">{\1}</span>', esc(path))


def render_op(entry: dict, schemas: dict) -> str:
    op, method = entry["op"], entry["method"]
    color = METHOD_COLOR.get(method, "#888")
    label, acolor, _ = AUTH_BADGE[entry["auth"]]
    parts = [
        f'<details class="op" id="{entry["anchor"]}" style="border-color:{color}55"',
        f' data-search="{esc((method + " " + entry["path"] + " " + op.get("summary", "") + " " + op.get("description", "")).lower())}">',
        f'<summary style="background:{color}12">',
        f'<span class="verb" style="background:{color}">{method.upper()}</span>',
        f'<span class="route">{render_route(entry["path"])}</span>',
        f'<span class="opsum">{esc(op.get("summary", ""))}</span>',
        f'<span class="auth" style="background:{acolor}">{esc(label)}</span>',
        "</summary><div class=\"body\">",
    ]
    if op.get("description"):
        parts.append(f'<p class="desc">{esc(op["description"])}</p>')

    params = op.get("parameters") or []
    if params:
        parts.append("<h4>파라미터</h4><table class=\"params\">"
                     "<tr><th>이름</th><th>위치</th><th>타입</th><th>필수</th><th>설명</th></tr>")
        for p in params:
            parts.append(
                "<tr>"
                f'<td><code>{esc(p.get("name", ""))}</code></td>'
                f'<td>{esc(p.get("in", ""))}</td>'
                f'<td class="ptype">{type_label(p.get("schema", {}))}</td>'
                f'<td>{"예" if p.get("required") else "—"}</td>'
                f'<td>{esc(p.get("description", ""))}</td></tr>')
        parts.append("</table>")

    rb = op.get("requestBody")
    if rb:
        mts = ", ".join(media_types(rb)) or "—"
        req = " · 필수" if rb.get("required") else ""
        parts.append(f'<h4>요청 본문 <span class="muted">{esc(mts)}{req}</span></h4>')
        parts.append(render_schema(body_schema(rb), schemas))

    parts.append("<h4>응답</h4>")
    for code, resp in sorted((op.get("responses") or {}).items()):
        cls = f"c{code[0]}" if code and code[0].isdigit() else ""
        schema = body_schema(resp)
        rendered = render_schema(schema, schemas) if schema else '<div class="muted">본문 없음</div>'
        parts.append(f'<div class="resp"><span class="code {cls}">{esc(code)}</span>'
                     f'<div><div>{esc(resp.get("description", ""))}</div>{rendered}</div></div>')

    parts.append(f'<p class="why">접근 권한 — <b>{esc(label)}</b>: {esc(entry["auth_why"])}</p>')
    parts.append("</div></details>")
    return "".join(parts)


def build_html(spec: dict, ops: list[dict], source_note: str) -> str:
    schemas = spec.get("components", {}).get("schemas", {})
    info = spec.get("info", {})
    groups = group_by_tag(ops, spec)

    out = [
        "<!doctype html>",
        "<!-- 생성물이다. 이 파일을 직접 고치지 않는다.\n"
        "     원본: docs/api/openapi.json + docs/api/tools/build_api_reference.py\n"
        "     다시 굽기: python3 docs/api/tools/build_api_reference.py\n"
        "     왜 Swagger UI가 아니라 이건지: docs/api/README.md -->",
        '<html lang="ko"><head><meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        f"<title>{esc(info.get('title', 'API'))} · API 레퍼런스</title>",
        f"<style>{CSS}</style></head><body>",
        "<header>",
        f"<h1>{esc(info.get('title', 'API'))} · API 레퍼런스</h1>",
        f'<div class="sub">OpenAPI {esc(spec.get("openapi", ""))} · 버전 {esc(str(info.get("version", "")))} · {esc(source_note)}</div>',
        "</header><div class=\"wrap\">",
    ]

    # 스펙의 `info.description` 은 여기 싣지 않는다. 그 글은 **Swagger UI 앞에 앉은 사람**한테
    # 쓴 것이라("우측 상단 Authorize", "localhost:8080 origin") 이 페이지로 옮기면 거짓말이 된다 —
    # 여긴 Authorize 버튼이 없고 주소도 localhost가 아니다. 대신 호출하는 사람에게 실제로
    # 필요한 것만 한 줄로 적는다. 왜 Swagger가 아니라 이 페이지인지는 docs/api/README.md 몫이다.
    out.append('<div class="notice"><b>인증</b> — HttpOnly 쿠키 세션(Redis). '
               '<code>Authorization: Bearer</code>를 쓰지 않는다. '
               '변경 요청(POST·PUT·PATCH·DELETE)은 <code>GET /api/auth/csrf</code>로 받은 토큰을 '
               '<code>X-XSRF-TOKEN</code> 헤더에 실어 보낸다. (ADR-0014)</div>')

    counts = {}
    for o in ops:
        counts[o["auth"]] = counts.get(o["auth"], 0) + 1
    out.append('<div class="meta">'
               f'<div>엔드포인트<strong>{len(ops)}</strong></div>'
               f'<div>태그<strong>{len(groups)}</strong></div>'
               f'<div>모델<strong>{len(schemas)}</strong></div>'
               f'<div>인증 없이 호출<strong>{counts.get("public", 0) + counts.get("signed", 0)}</strong></div>'
               "</div>")

    out.append('<div class="legend"><em>접근 권한</em>')
    for key, (label, color, why) in AUTH_BADGE.items():
        n = counts.get(key, 0)
        out.append(f'<span style="background:{color}" title="{esc(why)}">{esc(label)} {n}</span>')
    out.append("</div>")

    out.append('<input id="filter" type="search" '
               'placeholder="경로·요약·설명으로 거르기 (예: live-sessions, 자막, DELETE)">')

    for tag, desc, entries in groups:
        out.append('<section class="taggroup">')
        out.append(f'<h2 class="tag">{esc(tag)}<span class="count">{len(entries)}개</span></h2>')
        if desc:
            out.append(f'<p class="tagdesc">{esc(desc)}</p>')
        for entry in sorted(entries, key=lambda e: (e["path"], e["method"])):
            out.append(render_op(entry, schemas))
        out.append("</section>")

    out.append(f'<h2 class="models">모델 <span class="count">{len(schemas)}개</span></h2>')
    for name in sorted(schemas):
        out.append(f'<details class="model" id="model-{esc(name)}">'
                   f'<summary>{esc(name)}</summary>'
                   f'<div class="body">{render_schema(schemas[name], schemas, 1, frozenset({name}))}</div>'
                   "</details>")

    out.append(f"</div><script>{JS}</script></body></html>")
    return "".join(out)


# ---------------------------------------------------------------------------
# Markdown — 목록·권한만. 전체 스키마는 HTML 쪽이 본다.
# ---------------------------------------------------------------------------

def build_markdown(spec: dict, ops: list[dict], source_note: str) -> str:
    schemas = spec.get("components", {}).get("schemas", {})
    info = spec.get("info", {})
    groups = group_by_tag(ops, spec)
    counts: dict[str, int] = {}
    for o in ops:
        counts[o["auth"]] = counts.get(o["auth"], 0) + 1

    md = [
        f"# {info.get('title', 'API')} · 엔드포인트 목록",
        "",
        "> 📍 계약의 **정본은 [../CONTRACT.md](../CONTRACT.md)** 다. 이 파일은 "
        "**실제로 떠 있는 서버의 OpenAPI 스펙에서 생성**한 목록이라, 둘이 어긋나면 "
        "계약이 지켜지지 않았다는 뜻이다.",
        "",
        f"- 출처: {source_note}",
        f"- OpenAPI {spec.get('openapi', '')} · 엔드포인트 {len(ops)}개 · 모델 {len(schemas)}개",
        "- 파라미터·본문·응답 스키마까지 보려면 배포본 `/api-docs/` "
        "(원본 `frontend/public/api-docs/index.html`)",
        "",
        "## 접근 권한 요약",
        "",
        "`SecurityConfig.java` 의 체인을 경로별로 풀어 본 것이다. Swagger는 이걸 못 보여준다.",
        "",
        "| 배지 | 뜻 | 개수 |",
        "|---|---|---|",
    ]
    for key, (label, _color, why) in AUTH_BADGE.items():
        md.append(f"| **{label}** | {why} | {counts.get(key, 0)} |")
    md.append("")

    for tag, desc, entries in groups:
        md.append(f"## {tag}")
        md.append("")
        if desc:
            md.append(f"{desc}")
            md.append("")
        md.append("| 메서드 | 경로 | 하는 일 | 권한 |")
        md.append("|---|---|---|---|")
        for e in sorted(entries, key=lambda x: (x["path"], x["method"])):
            summary = (e["op"].get("summary") or "").replace("|", "\\|")
            label = AUTH_BADGE[e["auth"]][0]
            md.append(f"| `{e['method'].upper()}` | `{e['path']}` | {summary} | {label} |")
        md.append("")

    md.append("## 다시 만들기")
    md.append("")
    md.append("```bash")
    md.append("# 운영 백엔드에서 스펙을 뜬다 (밖에서는 /v3/api-docs 가 SPA로 떨어진다)")
    md.append("ssh ec2 'docker exec liveclass-backend-prod wget -qO- "
              "http://localhost:8080/v3/api-docs' > docs/api/openapi.json")
    md.append("python3 docs/api/tools/build_api_reference.py")
    md.append("```")
    md.append("")
    md.append("`SecurityConfig.java` 의 권한 체인을 고치면 "
              "`build_api_reference.py` 의 `AUTH_RULES` 도 같이 고친다 — "
              "여기 배지는 그 표에서 계산한 값이다.")
    md.append("")
    return "\n".join(md)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--from-url", dest="url",
                    help="스펙을 URL에서 직접 받는다 (예: http://localhost:8080/v3/api-docs)")
    ap.add_argument("--spec", default=str(OUT_DIR / "openapi.json"))
    args = ap.parse_args()

    if args.url:
        with urllib.request.urlopen(args.url, timeout=20) as r:
            raw = r.read().decode("utf-8")
        Path(args.spec).write_text(raw, encoding="utf-8")
        spec = json.loads(raw)
        source = f"{args.url} 에서 받음"
    else:
        spec = json.loads(Path(args.spec).read_text(encoding="utf-8"))
        source = f"{Path(args.spec).name} 스냅샷"

    note_path = OUT_DIR / "SNAPSHOT"
    if note_path.exists():
        source = note_path.read_text(encoding="utf-8").strip() or source

    ops = collect(spec)
    HTML_OUT.parent.mkdir(parents=True, exist_ok=True)
    HTML_OUT.write_text(build_html(spec, ops, source), encoding="utf-8")
    (OUT_DIR / "API.md").write_text(build_markdown(spec, ops, source), encoding="utf-8")

    counts: dict[str, int] = {}
    for o in ops:
        counts[o["auth"]] = counts.get(o["auth"], 0) + 1
    print(f"엔드포인트 {len(ops)}개 · 모델 "
          f"{len(spec.get('components', {}).get('schemas', {}))}개")
    for key, (label, _c, _w) in AUTH_BADGE.items():
        print(f"  {label:<11} {counts.get(key, 0)}")
    print(f"→ {HTML_OUT.relative_to(ROOT)}  (배포되면 /api-docs/ 로 열린다)")
    print(f"→ {(OUT_DIR / 'API.md').relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
