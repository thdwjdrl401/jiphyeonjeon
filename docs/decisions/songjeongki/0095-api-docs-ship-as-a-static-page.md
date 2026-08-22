# ADR-0095: API 문서는 Swagger UI가 아니라 정적 페이지로 내보낸다

> 📍 하네스 개요: [../../harness/README.md](../../harness/README.md) · 판단 정책: [../../harness/POLICY.md](../../harness/POLICY.md)

- **상태**: 채택
- **일자**: 2026-08-07
- **관련**: Sub Ⅲ · [ADR-0009](0009-java21-spring-boot-3.md)(springdoc 도입) · [ADR-0014](0014-auth-redis-session-cookie.md)(쿠키 세션 인증) · [CONTRACT.md](../../CONTRACT.md)

## 맥락 (Context)

운영에서 API 문서를 볼 방법이 없다는 걸 확인했다. springdoc은 붙어 있고 **백엔드 안에서는 잘 뜬다.**

```
docker exec liveclass-backend-prod wget -qO- localhost:8080/v3/api-docs   → 200 (OpenAPI JSON)
https://<운영도메인>/v3/api-docs                                          → 200 (SPA index.html)
https://<운영도메인>/api/v3/api-docs                                      → 401
```

밖에서만 안 된다. 두 군데가 어긋나 있다.

1. nginx(`frontend/nginx/app-locations.conf`)가 백엔드로 넘기는 경로는 `/api/`뿐인데, springdoc은
   `/swagger-ui/**`·`/v3/api-docs`에 붙어 있다 — 컨트롤러가 `@RequestMapping("/api/...")`로 접두사를
   직접 갖고 `server.servlet.context-path`가 없기 때문이다. 그래서 문서 경로만 프록시 규칙 밖으로
   떨어져 SPA fallback에 먹힌다. **200이라 열린 것처럼 보이지만 받아 보면 리액트 껍데기다.**
2. `/api/v3/api-docs`의 401은 반대 어긋남이다. 요청은 백엔드까지 가지만
   `SecurityConfig`의 permitAll이 `/api` 없는 경로로 적혀 있어 매칭되지 않는다.

즉 지금의 "안 열림"은 **결정의 결과가 아니라 배선 사고**다. 그래서 어떻게 열지를 정해야 했다.

## 결정 (Decision)

운영 스펙에서 구운 **정적 HTML 한 장을 프론트 정적 자산으로 배포한다.** 주소는 `/api-docs/`이고,
Swagger UI(`/swagger-ui`)와 스펙 엔드포인트(`/v3/api-docs`)는 **밖으로 열지 않는다.**

- 생성물: `frontend/public/api-docs/index.html` — Vite가 `public/`을 `dist/`로 그대로 옮기고
  nginx의 SPA fallback(`try_files $uri $uri/ /index.html`)이 실제 파일을 먼저 집는다.
  `/api-docs`는 `/api/`로 시작하지 않아 백엔드 프록시 location과 겹치지 않는다.
- 원본: `docs/api/openapi.json` + `docs/api/tools/build_api_reference.py`
- 접근 제한은 걸지 않는다. 누구나 연다.

## 근거 (Rationale)

**Swagger는 읽는 문서가 아니라 쏘는 도구다.** "Try it out"이 브라우저에서 진짜 요청을 보내는데,
이 서비스의 인증은 HttpOnly 쿠키 세션이다(ADR-0014). 그래서 **로그인한 채로 그 화면을 연 사람**이
버튼 한 번으로 운영 데이터를 바꿀 수 있다. 읽으라고 연 문서가 쓰기 버튼을 달고 있는 셈이다.
정적 HTML에는 그 버튼이 없다.

덤으로 얻는 것도 있다.

- **백엔드가 죽어도 열린다.** 문서는 nginx가 주는 정적 파일이다.
- **스펙 엔드포인트를 밖으로 열지 않아도 된다.** `/v3/api-docs`는 `SecurityConfig`에서 이미
  permitAll이라, 뚫는 순간 내부 API 표면이 인증 없이 통째로 공개된다.
- **Swagger가 못 보여주는 걸 실을 수 있다.** 엔드포인트마다 접근 권한 배지
  (공개/서명/로그인/STUDENT/INSTRUCTOR/ADMIN)를 붙였다. springdoc은 시큐리티 체인을 읽지 않아
  이걸 못 낸다. 그런데 이 API를 처음 보는 사람이 가장 먼저 묻는 게 "이거 로그인 없이 되나"다.

접근 제한을 안 거는 이유는, **경로는 비밀이 아니기 때문**이다. `/api/internal/**`이 드러나도
그것을 부르려면 HMAC 키가 필요하고(ADR-0008·0011·0036), 비밀은 키지 경로가 아니다.
제한이 필요해지면 nginx basic auth를 얹는다 — RabbitMQ UI가 이미 쓰는 패턴이다.

## 대안 (Alternatives)

| 대안 | 장점 | 단점 |
|---|---|---|
| **정적 페이지 (선택)** | 호출 버튼 자체가 없음 · 백엔드와 독립 · 권한 배지를 실을 수 있음 · 스펙 엔드포인트 비공개 유지 | **자동으로 최신이 아니다** — 다시 굽지 않으면 조용히 낡는다 |
| Swagger UI + `springdoc.swagger-ui.supported-submit-methods: []` | 항상 최신 · 설정 한 줄 | 전송 차단이 **UI의 예의일 뿐** — `/v3/api-docs`가 공개되고 curl은 그대로 통한다 · 백엔드가 죽으면 문서도 죽음 · 권한 표시 없음 |
| Swagger를 basic auth 뒤에 | 최신 + 접근 제한 | 자격증명 배포·관리 비용. 공유가 목적인데 공유가 번거로워짐 |
| 아무것도 안 함 (현행 유지) | 비용 0 | 운영 API를 볼 방법이 없다 |

`supported-submit-methods`는 springdoc이 만든 게 아니라 **Swagger UI 본체의 옵션**이다
(번들 기본값 `["get","put","post","delete","options","head","patch","trace"]`). 언제든 이 대안으로
갈아탈 수 있다는 뜻이고, 그래서 여기 남긴다.

## 영향·후속 (Consequences)

- **낡을 수 있다는 걸 문서가 스스로 말한다.** `docs/api/SNAPSHOT`에 스냅샷을 언제·어디서 떴는지
  적고, 표지에 그대로 찍는다. API가 바뀌면 다시 굽는다.
- **`SecurityConfig.java`와 `AUTH_RULES`가 손으로 묶여 있다.** 권한 배지는 스크립트의 `AUTH_RULES`가
  계산하는데, 이건 시큐리티 체인을 **옮겨 적은 표**지 코드에서 끌어온 값이 아니다. 한쪽만 고치면
  문서가 조용히 틀린 권한을 광고한다. 스크립트 주석과 `docs/api/README.md`에 적어 뒀다.
- 굽는 과정에서 드러난 빈 곳 — **`@Tag` 없는 컨트롤러 5개**(운영 콘솔·서버 간 경로),
  요약 없는 엔드포인트 12개. 문서를 손으로 채우지 말고 컨트롤러 애너테이션을 고쳐 다시 굽는다.
- `CONTRACT.md`(정해 놓은 것)와 이 문서(실제로 떠 있는 것)가 어긋나면, 문서를 맞추지 말고
  **어느 쪽이 틀렸는지부터 정한다.**
