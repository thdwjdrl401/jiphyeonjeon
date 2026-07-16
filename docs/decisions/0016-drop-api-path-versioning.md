# ADR-0016: API 경로 버저닝 제거 (`/api/v1` → `/api`)

> 📍 하네스 개요: [../harness/README.md](../harness/README.md) · 판단 정책: [../harness/POLICY.md](../harness/POLICY.md)

- **상태**: 채택
- **일자**: 2026-07-17
- **관련**: [ADR-0002](0002-react-typescript-frontend.md)(프론트 API 계약), [ADR-0009](0009-java21-spring-boot-3.md)(Spring Boot 4.1), [ADR-0014](0014-auth-redis-session-cookie.md)(쿠키 세션), [ADR-0015](0015-docker-deploy-fe-be-nginx.md)(배포·nginx 프록시), [CONTRACT.md](../CONTRACT.md)

## 맥락 (Context)
초기 스캐폴드는 API 경로에 버전 세그먼트를 두어 `/api/v1/...`로 계약했다. 그러나 **Spring Boot 4.1(Spring Framework 7)은 API 버저닝을 프레임워크가 1급으로 지원**한다:
- 핸들러에 `@RequestMapping(version = "1.1")`(또는 baseline `"1.1+"`) 같은 **`version` 속성**을 붙인다.
- `ApiVersionStrategy`/`ApiVersionResolver`가 요청의 **헤더·쿼리 파라미터·미디어타입·URL 경로 중 택한 방식**으로 버전을 해석하고, `WebMvcConfigurer#configureApiVersioning`에서 구성한다(예: `useRequestHeader("API-Version")`). 폐기 버전은 `Deprecation`/`Sunset` 헤더로 통지(RFC 9745/8594)까지 표준 지원.

즉 **경로 세그먼트에 버전을 하드코딩하는 것은 이 네이티브 기능과 중복**이며, 모든 경로·프론트 `baseURL`·문서·테스트에 `/v1`을 반복하는 비용만 남긴다. 게다가 지금은 공개 엔드포인트가 스모크 수준이고 소비자도 자체 프론트 하나뿐이라 **바꾸기 가장 싼 시점**이다.

## 결정 (Decision)
API 경로에서 버전 세그먼트를 제거한다: **`/api/v1/*` → `/api/*`**.
- 버전이 실제로 필요해지면 **경로가 아니라 Spring 네이티브 버저닝으로 선언적 처리**한다: 핸들러에 `@RequestMapping(version = "1.1")`, `configureApiVersioning`에서 `ApiVersionStrategy` 구성(헤더/미디어타입 등). 경로에 버전을 다시 박지 않는다.
- 배포 nginx는 `/api/` **prefix 프록시**([ADR-0015](0015-docker-deploy-fe-be-nginx.md))라 이 변경과 무관하게 불변이다.

## 근거 (Rationale)
- **프레임워크 기본 기능과 중복 제거**: Spring 7 네이티브 버저닝이 헤더/쿼리/미디어타입/경로 어느 방식이든 커버하므로, 경로에 `/v1`을 박는 것은 잉여다.
- **경로·계약 단순화**: `/v1` 반복이 사라져 코드·프론트 `baseURL`·문서·테스트의 중복과 유지비가 준다.
- **저비용 시점 + 프록시 불변**: 엔드포인트·소비자가 최소라 변경 폭이 작고, `/api/` prefix 프록시 덕에 인프라 재작업이 없다.

## 대안 (Alternatives)
| 대안 | 장점 | 단점 |
|---|---|---|
| **경로 버저닝 제거 (선택)** | 경로 단순·중복 제거. 버전은 Spring 네이티브(`@RequestMapping(version=…)`)로 | 경로 기반 버저닝 포기(→ 필요 시 어노테이션/헤더) |
| `/api/v1` 유지 | 변경 불필요 | Spring 네이티브 버저닝과 중복, 실익 없는 세그먼트를 전 계약에 반복 |
| 경로 버저닝 강화(`/v2` 대비 구조화) | 명시적 버전 | 현 단계 과설계, 프레임워크 기능과 중복 |

## 영향·후속 (Consequences)
- **코드 변경(완료)**:
  - 백엔드: `SessionSmokeController`(`@RequestMapping("/api")`), `SecurityConfig`(permitAll 매처 `/api/ping`, `/api/session/**`).
  - 프론트: `shared/api/client.ts`(`baseURL='/api'`), 계약 테스트 `App.test.tsx`(`toBe('/api')`), `vite.config.ts` dev 프록시 키 `/api`.
- **문서 변경**: [CONTRACT.md](../CONTRACT.md), [RUN.md](../../RUN.md), `AGENTS.md`, `frontend/AGENTS.md`, `T0-BOOTSTRAP.md`, 하네스 템플릿 경로 표기 갱신. `docs/frontend/api/*`는 진행 중인 프론트 계약 리네이밍(course→curriculum)과 같은 줄에서 겹쳐 그 작업과 함께 반영.
- **검증(완료)**: 프론트 계약 테스트(`baseURL==='/api'`) 통과(Node 20), 백엔드 스모크 `/api/ping`·`/api/session/touch`(Secure 쿠키) 정상, 옛 `/api/v1/*`는 미매핑.
- **후속**: 버전 도입이 필요해지면 `@RequestMapping(version=…)` + `ApiVersionStrategy`로 처리하는 ADR을 별도 작성.
