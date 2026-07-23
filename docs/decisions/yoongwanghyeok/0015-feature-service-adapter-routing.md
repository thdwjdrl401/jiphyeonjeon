# ADR-0015: 프론트 데이터 소스는 feature 서비스 구현체 단위로 전환한다

> 원칙: [ADR-0008](0008-frontend-runtime-and-data-source-boundary.md) · 대체 결정: [ADR-0014](0014-operation-level-hybrid-api-routing.md)

- **상태**: 채택
- **일자**: 2026-07-23
- **적용 범위**: 프론트 데이터 서비스, mock/HTTP 런타임 선택, fixture 경계

## 맥락

함수마다 `mock`, `http`, `apiImplemented`를 함께 두는 하이브리드 방식은 `VITE_USE_MOCK_API=true`에서도 일부 HTTP 요청을 발생시켰다. 한 사용자 흐름에서 인증은 HTTP, 대시보드는 mock처럼 데이터 원본이 섞일 수 있고, 구현 여부 플래그가 실제 서버 상태와 표류했다. mock과 HTTP 코드가 같은 파일에 있어 실제 API 구현을 교체할 때 화면용 코드까지 함께 수정해야 했다.

## 결정

1. feature 데이터 서비스는 공통 인터페이스와 `mock`, `http` 구현체를 서로 다른 파일로 둔다.
2. 기존 `*Service.ts`는 환경값으로 구현체 하나를 선택하고 화면에 안정적인 함수 facade를 제공한다.
3. `VITE_USE_MOCK_API=true`이면 모든 feature가 mock 구현체를 사용하고 `/api` 요청을 차단한다.
4. `VITE_USE_MOCK_API=false`이면 모든 feature가 HTTP 구현체를 사용한다. HTTP 오류를 mock으로 fallback하지 않는다.
5. 함수별 `apiImplemented` 메타데이터와 `hybrid` 상태를 제거한다.
6. 페이지와 레이아웃은 mock/demo 모듈을 직접 import하지 않는다.
7. 테스트 모드는 통합 mock을 기본으로 사용하되 HTTP 구현체는 구현체 단위 테스트에서 직접 검증한다.

## 근거

- 한 실행에서 데이터 원본이 섞이지 않아 ID, 권한, 상태 전이가 일관된다.
- 실제 API 준비 시 HTTP 구현체만 교체하면 되며 페이지와 hook은 영향을 받지 않는다.
- 인터페이스가 mock/HTTP 반환 모델의 차이를 컴파일 시점에 드러낸다.
- mock 모드의 네트워크 차단이 선택 경계 우회를 즉시 발견한다.

## 대안

| 대안 | 장점 | 단점 |
|---|---|---|
| 함수별 하이브리드 선택 | endpoint별 점진 연동 | 데이터 혼합, 플래그 표류, 구현 혼재 |
| HTTP 실패 시 mock fallback | 화면 유지 | 서버 장애와 계약 오류 은폐 |
| **feature 구현체 단위 선택(채택)** | 일관된 원본, 교체 가능한 구조 | 구현체 파일 수 증가 |

## 영향·후속

- ADR-0014의 함수별 하이브리드 규칙을 대체하고 ADR-0008의 단일 mock/HTTP 경계를 복원한다.
- 새 데이터 기능은 인터페이스를 먼저 정의하고 mock/HTTP 구현체를 같은 반환 모델로 맞춘다.
- 실제 API 미구현은 HTTP 모드에서 명시적으로 드러내며 mock 성공으로 숨기지 않는다.
- 이번 변경은 기존 API 필드와 상태코드를 바꾸지 않으므로 `CONTRACT.md` 갱신과 신규 계약 테스트는 필요하지 않다. 대신 선택기 단위 테스트와 기존 화면 회귀 테스트로 경계를 검증한다.
