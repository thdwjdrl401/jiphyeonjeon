# ADR-0016: 종료된 수강은 레코드를 재사용해 재신청하고 IMMEDIATE 소비 경로를 유지한다

> 관련 결정: [통합 mock 도메인 상태](0010-integrated-mock-domain-state.md) · [feature 서비스 구현체 전환](0015-feature-service-adapter-routing.md) · 서버 viewerContext [ADR-0026](../songjeongki/0026-catalog-viewer-context.md)

- **상태**: 채택
- **일자**: 2026-07-23
- **적용 범위**: 수강 상태 전이, 프론트 mock/HTTP 공통 계약, 커리큘럼 상세 수강 UX

## 맥락

백엔드는 `CANCELLED`, `REJECTED`, `REVOKED` 상태에서 재신청하면 `(curriculumId, userId)`가 같은 기존 수강 행을 되살린다. 반면 프론트 mock은 취소 시 수강 행을 삭제하고 모든 신청을 `PENDING`으로 만들어 실제 상태 머신과 달랐다.

백엔드는 일반 커리큘럼 생성 API에서 `APPROVAL_REQUIRED`를 기본으로 사용하지만 `IMMEDIATE` enum과 즉시 `ACTIVE`로 전환하는 학생 신청 경로는 유지하고 있다. 프론트 타입도 `IMMEDIATE`를 받을 수 있으나 mock 동작과 안내 문구가 승인제로 고정되어 있었다.

## 결정

1. `CANCELLED`, `REJECTED`, `REVOKED` 이후 재신청을 허용한다.
2. 재신청은 새 수강 레코드를 만들지 않고 기존 `enrollmentId`를 유지한다.
3. `PENDING` 또는 `ACTIVE` 상태의 중복 신청은 계속 충돌로 처리한다.
4. `APPROVAL_REQUIRED` 신청은 `PENDING`, `IMMEDIATE` 신청은 즉시 `ACTIVE`가 된다.
5. 프론트 mock은 취소 시 레코드를 삭제하지 않고 `CANCELLED`로 변경한다.
6. 프론트의 mock과 HTTP 구현체는 같은 `EnrollmentStatus` 및 `EnrollResult` 계약을 사용한다.
7. 백엔드의 `IMMEDIATE` enum과 처리 분기는 삭제하지 않는다.
8. 강사 커리큘럼 생성·수정 화면에는 아직 수강 방식 선택 UI를 노출하지 않는다. 현재 백엔드 생성·수정 요청이 `enrollmentType`을 받지 않아 프론트만 추가하면 mock 전용 기능이 되기 때문이다.

## 근거

- 종료 상태를 삭제하지 않으면 현재 백엔드의 유일성 제약 및 상태 전이와 일치한다.
- mock과 HTTP가 동일한 초기 상태를 반환하므로 `VITE_USE_MOCK_API` 전환 시 화면 로직을 바꿀 필요가 없다.
- 서버가 `IMMEDIATE` 커리큘럼을 반환하면 프론트는 즉시 수강 UX로 처리할 수 있다.
- 저장할 수 없는 강사 설정 UI를 먼저 노출하지 않아 mock과 실제 API의 기능 차이를 만들지 않는다.

## 영향·후속

- `IMMEDIATE` fixture는 신청 직후 `ENROLLED` 관계와 학습 접근을 제공한다.
- `REVOKED` fixture는 미수강처럼 재신청할 수 있고 재신청 후 동일한 `enrollmentId`를 유지한다.
- 강사가 `IMMEDIATE`를 선택하게 하려면 백엔드 create/update DTO와 응답 계약, 저장 검증, FE/BE 계약 테스트를 함께 추가해야 한다.
- 이번 변경은 기존 백엔드 API 필드·상태코드·URL을 바꾸지 않으므로 `CONTRACT.md` 변경은 필요하지 않다.
