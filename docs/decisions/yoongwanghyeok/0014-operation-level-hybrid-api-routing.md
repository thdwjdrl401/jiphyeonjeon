# ADR-0014: 프론트 API 전환은 함수별 구현 메타데이터로 분기한다

> 이전 결정: [ADR-0008](0008-frontend-runtime-and-data-source-boundary.md) · 점진 전환 배경: [ADR-0027](../songjeongki/0027-frontend-incremental-api-cutover.md)

- **상태**: 대체됨(→ [ADR-0015](0015-feature-service-adapter-routing.md))
- **일자**: 2026-07-22
- **적용 범위**: 프론트 데이터 조회·변경 함수의 mock/HTTP 선택

## 맥락

기존 화면에는 공통 데이터 소스 경계를 쓰는 함수와 demo/mock 함수를 직접 호출하는 화면이 함께 있었다. 이 구조에서는 `VITE_USE_MOCK_API=false`여도 일부 기능이 mock 성공 상태를 표시해 백엔드 미구현이나 계약 오류를 발견하기 어려웠다. 반대로 `true`에서 구현 완료된 API까지 mock으로 고정하면 기능별 점진 연동이 불가능했다.

## 결정

1. 서버 상태를 읽거나 변경하는 모든 프론트 함수는 `mock`, `http`, `apiImplemented`를 가진 `requestByDataSource` 경계를 통과한다.
2. 선택 규칙은 다음과 같다.
   - `VITE_USE_MOCK_API=false`: `apiImplemented`와 무관하게 HTTP를 호출한다. 미구현 endpoint의 오류도 숨기지 않는다.
   - `VITE_USE_MOCK_API=true`: `apiImplemented=true`인 함수는 HTTP, `false`인 함수는 mock을 사용한다.
   - 테스트 모드: 네트워크 의존을 막기 위해 항상 mock을 사용한다. HTTP adapter 단위 테스트는 테스트 모드를 명시적으로 해제한다.
3. 백엔드가 아직 구현하지 않은 기능에도 예상 HTTP endpoint와 요청 구조를 둔다. 자동 mock fallback은 하지 않는다.
4. 페이지·레이아웃은 demo/mock 모듈을 직접 import하지 않고 TanStack Query 또는 mutation을 통해 서비스 함수만 호출한다.
5. WebSocket 채팅 계약 변경은 이 결정 범위에서 제외한다. REST 채팅은 `/api/live-sessions/{sessionId}/messages`를 사용한다.

## 영향

- `false`는 백엔드 미구현과 계약 오류를 즉시 드러내는 검증 모드가 된다.
- `true`는 구현된 API를 실제로 검증하면서 미구현 화면만 fixture로 유지하는 하이브리드 모드가 된다.
- 함수의 `apiImplemented` 값이 실제 백엔드 구현 상태와 어긋나지 않도록 endpoint 구현 시 함께 갱신해야 한다.
- ADR-0008의 “`true`이면 전부 mock” 규칙과 ADR-0027의 “직접 demo 호출을 중간 상태로 허용” 부분은 이 결정으로 대체한다.
