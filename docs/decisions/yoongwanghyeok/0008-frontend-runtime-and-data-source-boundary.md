# ADR-0008: 프론트 실행 경계 = 독립 Vite 서버 + 단일 mock/HTTP 선택

> 구현 가이드: [IMPLEMENTATION_GUIDE.md](../../frontend/IMPLEMENTATION_GUIDE.md) · 데이터 소스: [dataSource.ts](../../../frontend/src/shared/api/dataSource.ts) · 런타임 설정: [runtime.ts](../../../frontend/src/shared/config/runtime.ts)

- **상태**: 일부 대체 — 함수별 선택 규칙은 [ADR-0014](0014-operation-level-hybrid-api-routing.md) 적용
- **일자**: 2026-07-21
- **적용 범위**: 프론트 개발·빌드 방식, fixture와 실제 API의 선택 경계

## 맥락

초기에는 React 결과물을 백엔드 `resources`에 포함해 Spring 서버 하나로 제공하는 방식을 고려했다. 이후 프론트와 백엔드를 각각 실행하는 방식으로 변경했고, 백엔드 API가 아직 완성되지 않은 상태에서도 모든 화면을 개발·검토할 수 있어야 했다.

기능별로 fixture 사용 여부를 따로 판단하면 한 화면 안에서 mock 데이터와 실제 API 데이터가 섞인다. 특히 목록은 fixture인데 상세는 실제 API를 호출하는 식의 혼합은 ID·수강 상태·권한이 서로 달라지는 원인이 된다.

## 결정

1. 프론트는 Vite 개발 서버와 정적 빌드를 독립적으로 실행한다. 빌드 산출물을 백엔드 `resources`에 복사하지 않는다.
2. 모든 프론트 데이터 서비스는 `VITE_USE_MOCK_API` 하나로 mock/HTTP를 선택한다.
3. 선택 규칙은 다음과 같다.
   - `true`: 통합 mock 저장소만 사용하고 실제 `/api` 요청을 차단한다.
   - `false`: 구현된 HTTP 서비스를 통해 실제 `/api`를 호출한다.
   - 미설정: 개발 모드는 mock, 프로덕션 빌드는 HTTP를 사용한다.
   - 테스트 모드: 외부 환경값과 관계없이 mock을 사용한다.
4. 각 feature가 환경 변수를 직접 읽지 않고 `requestByDataSource` 또는 `selectDataSource`를 통해 선택한다.
5. 실제 모드에서 미구현 API가 있다고 해서 해당 기능만 fixture로 조용히 fallback하지 않는다. 미구현 상태를 명시적으로 드러내 혼합 데이터를 방지한다.
6. 실제 API에 아직 없는 선택 필드는 응답에서 안전한 기본값으로 정규화할 수 있지만, 합의되지 않은 요청 필드를 임의로 전송하지 않는다.

## 근거

- 프론트와 백엔드의 실행·배포 주기를 분리할 수 있다.
- 단일 환경 변수로 전체 데이터 경계를 전환하면 재현 가능한 테스트 시나리오를 만든다.
- mock/HTTP 혼합을 막으면 같은 ID가 화면마다 다른 관계와 상태로 해석되는 문제를 조기에 발견할 수 있다.
- 실제 모드의 실패를 fixture로 숨기지 않아 API 구현 누락을 정확히 확인할 수 있다.

## 대안

| 대안 | 장점 | 단점 |
|---|---|---|
| 프론트 빌드를 Spring resources에 포함 | 배포 서버 하나 | FE/BE 빌드 결합, 개발 피드백 지연 |
| feature별 mock 환경 변수 | 부분 연동 편리 | 조합 폭증, 화면 간 데이터 불일치 |
| HTTP 실패 시 자동 fixture fallback | 화면이 계속 보임 | 실제 장애·계약 오류 은폐 |
| **독립 서버 + 단일 선택 경계(선택)** | 실행 분리, 일관된 시나리오 | 실제 API 전환 시 미구현 기능이 바로 드러남 |

## 영향·후속

- 쿠키 인증을 실제 서버 간에 사용할 때 CORS, `credentials`, CSRF, 개발 proxy 정책을 함께 검증해야 한다.
- 새 데이터 서비스는 반드시 공통 데이터 소스 경계를 통과해야 한다.
- 실제 API 전환 시 fixture와 HTTP 응답을 같은 프론트 도메인 모델로 정규화하고 계약 테스트를 추가한다.
- 환경 변수 변경 후에는 Vite 개발 서버를 다시 시작해야 한다.

