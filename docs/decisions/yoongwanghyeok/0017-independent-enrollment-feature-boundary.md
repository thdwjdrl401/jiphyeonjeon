# ADR-0017: 수강 기능을 독립 feature 서비스 경계로 분리한다

> 관련 결정: [통합 mock 도메인 상태](0010-integrated-mock-domain-state.md) · [feature 서비스 구현체 전환](0015-feature-service-adapter-routing.md) · [수강 재신청 정책](0016-enrollment-reapplication-and-immediate-policy.md)

- **상태**: 채택
- **일자**: 2026-07-23
- **적용 범위**: 프론트 수강 신청·취소·내 수강 목록·강사 수강생 관리와 mock/HTTP 전환 경계

## 맥락

수강 기능의 타입과 일부 UI는 `features/enrollment`에 있었지만, 신청·취소 API는 `curriculum-detail`, 내 수강 목록 API는 `curriculum`, 변경 가능한 mock 수강 레코드는 `demo/mockDatabase`, 강사 수강생 표는 페이지의 고정 데이터에 흩어져 있었다. 이 구조에서는 `VITE_USE_MOCK_API` 분기 구현을 교체할 때 여러 feature와 페이지를 동시에 수정해야 하고, 같은 수강 상태 머신을 화면마다 다르게 구현할 위험이 있었다.

## 결정

1. `features/enrollment`가 수강 도메인의 타입, 서비스 인터페이스, mock/HTTP 구현체, mock 저장소, Query/Mutation 훅을 소유한다.
2. `EnrollmentService`는 학생 신청·취소·내 수강 목록과 강사 roster 조회·승인·거절·제적을 하나의 계약으로 제공한다.
3. `enrollmentService.ts`에서 `VITE_USE_MOCK_API`를 한 번 판정해 `mockEnrollmentService` 또는 `httpEnrollmentService` 전체 구현체를 선택한다.
4. 페이지와 운영 코드의 서비스는 수강 API 구현체나 fixture를 직접 호출하지 않고 enrollment 훅 또는 공개 facade만 사용한다. 여러 도메인의 화면 모델을 만드는 mock 전용 어댑터는 enrollment 저장소를 읽어 조합할 수 있다.
5. 변경 가능한 mock 수강 레코드는 `mockEnrollmentStore.ts`가 소유한다. `demo/mockDatabase.ts`는 viewer context와 학습 진행률을 계산할 때 해당 저장소를 읽을 수 있지만 수강 쓰기 함수를 소유하지 않는다.
6. 강사 관리 화면의 고정 수강생 표를 제거하고 실제 roster 조회 및 상태 전이 컴포넌트를 합성한다.
7. 기존 백엔드 URL, 요청·응답 필드, 상태코드는 변경하지 않는다.

## 파일 책임

| 파일 | 책임 |
|---|---|
| `enrollmentService.interface.ts` | 화면이 의존하는 수강 기능 계약 |
| `mockEnrollmentService.ts` | mock 정책과 상태 전이 구현 |
| `httpEnrollmentService.ts` | 백엔드 endpoint 호출 및 응답 매핑 |
| `enrollmentService.ts` | 환경 변수 기반 구현체 선택과 공개 facade |
| `mockEnrollmentStore.ts` | 변경 가능한 mock 수강 레코드의 단일 원본 |
| `useEnrollmentQueries.ts` | 내 수강·강사 roster 서버 상태 조회 |
| `useEnrollmentMutations.ts` | 신청·취소·승인·거절·제적과 캐시 무효화 |

## 근거

- 수강 상태 머신과 API 계약의 변경 지점이 하나의 feature에 모인다.
- `VITE_USE_MOCK_API`를 바꿔도 페이지 호출 구조가 변하지 않는다.
- HTTP 구현이 준비될 때 인터페이스를 유지한 채 구현체만 교체하거나 완성할 수 있다.
- 학생 화면과 강사 화면이 동일한 mock 레코드를 읽고 변경하므로 상태가 일관된다.

## 영향·후속

- `curriculum-detail`은 커리큘럼 상세 조회만, `myCurriculumsService`는 강사 커리큘럼과 대시보드만 담당한다.
- 수강 endpoint 계약 테스트와 강사 roster 상태 전이 UI 테스트를 유지한다.
- 백엔드 계약을 변경하지 않았으므로 이번 리팩터링만으로 `docs/CONTRACT.md`를 수정하지 않는다.
