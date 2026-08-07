# API 레퍼런스 (생성물)

> 📍 계약의 정본: [../CONTRACT.md](../CONTRACT.md) · 아키텍처: [../ARCHITECTURE.md](../ARCHITECTURE.md)

운영에 뜬 백엔드가 실제로 광고하는 API 표면을 **정적 문서로 구워 서비스에서 바로 연다.**

**→ 배포되면 `https://<도메인>/api-docs/`**

| 파일 | 무엇 |
|---|---|
| `../../frontend/public/api-docs/index.html` | **화면.** 태그별 접기, 파라미터·요청·응답 스키마, 모델 142개, 검색. Vite가 `public/`을 그대로 실어 나가므로 배포하면 `/api-docs/`에서 열린다 |
| [`API.md`](API.md) | 엔드포인트 130개 목록 + 권한 — diff·grep 용 |
| `openapi.json` | 스펙 스냅샷 (원본) |
| `SNAPSHOT` | 그 스냅샷을 언제·어디서 떴는지 한 줄 |
| `tools/build_api_reference.py` | 위를 만드는 스크립트 |

**`index.html`·`API.md`를 직접 고치지 않는다.** 원본은 `openapi.json`과 스크립트다.

## 왜 Swagger UI 대신 이건가

**Swagger는 실제로 호출을 쏜다.** "Try it out"이 브라우저에서 진짜 요청을 보내고, 이 서비스는
세션 쿠키 인증이라 **로그인한 채로 그 화면을 연 사람**이 실수로 운영 데이터를 바꿀 수 있다.
읽으라고 연 문서가 쓰기 버튼을 달고 있는 셈이다. 정적 HTML에는 그 버튼이 없다 — **읽기만 된다.**

부수 효과도 얻는다.

- 백엔드가 죽어도 열린다. 문서는 nginx가 주는 정적 파일이다.
- 스펙 엔드포인트(`/v3/api-docs`)를 밖으로 열지 않아도 된다.
- 무엇을 실을지 우리가 고른다(지금은 전부 싣는다).

값은 하나다. **자동으로 최신이 아니다** — API가 바뀌면 다시 구워야 하고, 안 구우면 조용히
낡는다. `SNAPSHOT` 파일에 언제 뜬 스냅샷인지 적어 두는 이유다.

### Swagger UI를 열 수도 있나 — 된다, 다만

springdoc은 붙어 있고 백엔드 안에서는 이미 잘 뜬다(`localhost:8080/v3/api-docs` → 200).
밖에서 안 될 뿐이다. nginx가 백엔드로 넘기는 경로가 `/api/`뿐인데 springdoc은
`/swagger-ui/**`·`/v3/api-docs`에 붙어 있어서다(컨트롤러가 `@RequestMapping("/api/...")`로
접두사를 직접 갖고 `context-path`가 없다). 그래서 문서 경로만 프록시 규칙 밖으로 떨어져
SPA fallback에 먹힌다. `/api/v3/api-docs`의 401은 반대 어긋남이다 — `SecurityConfig`의
permitAll이 `/api` 없는 경로로 적혀 있어 매칭되지 않는다.

열려면 nginx에 location 둘을 추가하고, 호출 버튼은 이렇게 끈다(springdoc 3.0.3 확인):

```yaml
springdoc:
  swagger-ui:
    supported-submit-methods: []   # "Try it out" 실행 버튼 제거
```

> ⚠️ **이건 UI의 예의지 보안 통제가 아니다.** 버튼이 사라져도 API는 그대로 열려 있고
> `/v3/api-docs`도 인증 없이 공개된다(`SecurityConfig`가 이미 permitAll). curl 한 줄이면
> 똑같이 호출된다. "실수로 누르는 것"은 막지만 "부르지 못하게"는 아니다.

## 다시 만들기

```bash
# 1) 스펙을 뜬다 — 밖에서는 못 받으므로 컨테이너 안에서
ssh ec2 'docker exec liveclass-backend-prod wget -qO- http://localhost:8080/v3/api-docs' \
  > docs/api/openapi.json
echo "openapi.json 스냅샷 — 운영 백엔드(master <커밋>) $(date +%F) 채취" > docs/api/SNAPSHOT

# 2) 문서를 굽는다 (frontend/public/api-docs/index.html + docs/api/API.md)
python3 docs/api/tools/build_api_reference.py
```

로컬 백엔드가 떠 있으면 한 번에:

```bash
python3 docs/api/tools/build_api_reference.py --from-url http://localhost:8080/v3/api-docs
```

PDF가 필요하면 브라우저에서 **Ctrl+P**. 인쇄 직전에 접힌 것을 전부 펴고 페이지 경계에서
글자가 잘리지 않게 하는 규칙이 문서 안에 들어 있다.

## Swagger가 못 보여주는 것 — 접근 권한

각 엔드포인트에 **공개 / 서명 / 로그인 / STUDENT / INSTRUCTOR / ADMIN** 배지를 붙였다.
springdoc은 시큐리티 체인을 읽지 않아 이걸 못 낸다. 그런데 이 API를 처음 보는 사람이 가장 먼저
묻는 게 "이거 로그인 없이 되나"다.

배지는 스크립트의 `AUTH_RULES`가 계산한다 — `SecurityConfig.java`의
`authorizeHttpRequests` 체인을 **순서까지 그대로** 옮긴 표이고, 먼저 맞는 규칙이 이긴다.

> ⚠️ **`SecurityConfig.java`를 고치면 `AUTH_RULES`도 같이 고친다.** 코드에서 자동으로 끌어오는
> 값이 아니다. 어긋나면 문서가 조용히 틀린 권한을 광고한다.

지금 인증 없이 호출되는 건 17개다 — 로그인·CSRF 5, 공개 카탈로그 2, 그리고 서명으로 인증하는
서버 간 호출 10(LiveKit webhook, AI 워커·media-worker HMAC, 판서 문서 LiveKit 토큰).

## 문서가 비어 있는 곳

생성해 보니 드러난 것이다. 문서를 손으로 채우지 말고 **컨트롤러의 `@Tag`·`@Operation`을 고쳐**
다시 굽는다.

- **`@Tag`가 없는 컨트롤러 5개** — 클래스명이 그대로 태그로 나온다.
  `egress-admin-controller`(3) · `recorded-stt-internal-controller`(4) ·
  `media-transcode-internal-controller`(2) · `recording-admin-controller`(2) ·
  `live-admin-controller`(1). 전부 운영 콘솔·서버 간 경로라 사람이 덜 보던 쪽이다.
- **요약 없는 엔드포인트 12개 / 설명 없는 엔드포인트 21개** — 위 12개와 대체로 겹친다.

## 스펙에 없는 엔드포인트

`@Hidden`이 붙은 것은 OpenAPI에 실리지 않는다. 지금은 하나다.

| 경로 | 왜 숨겼나 |
|---|---|
| `GET /api/annotation-interpret-images/{token}` | 받아가는 쪽이 모델 제공자 서버라 사람이 부를 API가 아니다. 128비트 난수 토큰이 곧 자격(ADR-0058) |

소스의 `@*Mapping` 132개 중 스펙에 130개가 실려 있고, 차이는 이 하나와 상수로 정의된 경로 표기
하나뿐이다. **숨긴 엔드포인트도 인증은 걸려 있다** — 문서에 없는 것과 열려 있는 것은 다르다.

## CONTRACT.md 와의 관계

`CONTRACT.md`가 **정해 놓은 것**이고, 이쪽은 **실제로 떠 있는 것**이다. 둘이 어긋나면
계약이 지켜지지 않았다는 뜻이므로, 문서를 맞추지 말고 어느 쪽이 틀렸는지부터 정한다.
