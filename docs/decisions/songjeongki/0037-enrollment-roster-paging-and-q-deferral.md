# ADR-0037: 강사 수강생 로스터(ENROLLEE-01) — 단일 페이지 엔드포인트·summary 집계·`q` 검색 보류

> 📍 하네스 개요: [../../harness/README.md](../../harness/README.md) · 아키텍처: [../../ARCHITECTURE.md](../../ARCHITECTURE.md) · 계약: [../../CONTRACT.md](../../CONTRACT.md)

- **상태**: 채택
- **일자**: 2026-07-22
- **관련**: [0017](0017-schema-ownership-core-ai.md), [0025](0025-structure-reorder-and-version-cas.md), FE 계약 [docs/frontend/api/CURRICULUM_MANAGEMENT.md](../../frontend/api/CURRICULUM_MANAGEMENT.md) §8.1

## 맥락
- 계약 §8.1은 `GET /api/instructor/curriculums/{id}/enrollments?q=&status=&page=&size=`를 **하나의 페이지 엔드포인트**로 정의하고, 응답에 `summary`(상태별 건수) + 공통 페이지 봉투 + 중첩 `student` 객체 + `allowedTransitions`를 둔다.
- 구현은 페이지 없는 두 엔드포인트(`/enrollments` = PENDING만, `/enrollments/active` = ACTIVE만)가 평평한 `List<EnrollmentApplicantResponse>`를 내려주고 있었다. 수강생이 늘면 전량 응답이고, 상태 탭·건수 배지를 만들 수단이 없었다.
- §8.1은 "검색 가능한 학생 필드와 강사에게 공개할 정보 범위는 개인정보 정책과 함께 확정한다"고 명시적으로 열어 두었다.

## 결정
1. **엔드포인트 하나로 통합.** `GET .../enrollments`에 `status`(옵션, 생략 = 전 상태)·`page`(기본 0)·`size`(기본 20, 상한 100 — `CatalogController`와 같은 clamp 규칙). `/enrollments/active`는 **삭제**한다(`?status=ACTIVE`가 대체). 소유권 검증(`requireOwned`)은 그대로 — 비소유 강사 403, 없는 커리큘럼 404.
2. **응답 봉투 = `summary` + 기존 `PageResponse` 필드.** 새 페이징 모양을 만들지 않고 `PageResponse.of(...)`가 계산한 값을 그대로 펼친다(`EnrollmentRosterResponse`).
3. **`summary`는 집계 쿼리 1회.** `GROUP BY status` JPQL(`EnrollmentRepository.countByStatus`)로 DB에서 세고 행을 적재하지 않는다. 필터·페이지와 무관하게 **커리큘럼 전체 기준**이다(탭 배지 용도). 계약 예시는 pending·active·revoked만 보여주지만 rejected·cancelled도 함께 내려준다 — 필터 탭이 전 상태를 다루는데 두 개만 빼면 FE가 다시 물어야 한다(추가 필드는 계약상 허용).
4. **`q`(학생 검색)는 구현하지 않고, 파라미터로 받지도 않는다.** 선언해 놓고 무시하면 FE가 "먹히는데 결과가 이상하다"고 오해한다. 미선언이므로 `?q=김`은 Spring MVC가 그냥 버린다. Swagger 설명에 "아직 미지원 + 사유"를 적어 둔다.
5. **`student.email` 유지.** 계약 예시엔 `userId`·`displayName`만 있으나 §8.1이 공개 범위를 TBD로 두었고, 이 프로젝트는 이미 강사에게 신청자 이메일을 노출하기로 정했다(기존 `EnrollmentApplicantResponse`). PII 채널은 그대로 `auth.api.UserContact`만 쓰고 `UserView`는 넓히지 않는다.
6. **`allowedTransitions`는 "강사가 할 수 있는 액션" 집합.** PENDING → `[ACTIVE, REJECTED]`, ACTIVE → `[REVOKED]`, 종료 상태(REJECTED/REVOKED/CANCELLED) → `[]`. 학생 본인만 하는 CANCELLED는 포함하지 않으므로 상태기계 전체 전이표와 다르다 — 그래서 `EnrollmentStatus`(enrollment 모듈)가 아니라 강사용 응답 DTO에 둔다.
7. **N+1 없음.** 현재 페이지 행의 userId만 모아 `userDirectory.findContacts(...)` 배치 1회로 보강한다(`Page.map`).
8. **모듈 경계 유지.** enrollment의 읽기 포트에 `findPage(curriculumId, statusOrNull, pageable)`·`countsByStatus(curriculumId)`를 추가하고 `activeFor`/`pendingFor`는 제거했다. 정렬 필드명(`requestedAt`, `id`)은 enrollment 안에서 채운다 — 호출자가 unsorted `Pageable`을 주면 모듈이 자기 정규 정렬(신청 순 + id 타이브레이커)을 적용한다. enrollment은 여전히 auth·curriculum을 모른다.

## 근거
- `q`는 `enrollment` 행 × `auth` 사용자의 **모듈 간 조인**을 요구한다. 지금 구조에선 (a) enrollment이 auth를 의존하거나 (b) auth에서 이름/이메일로 userId를 먼저 뽑아 `IN` 절로 넘기는 두 갈래인데, (a)는 [0017] 경계를 깨고 (b)는 검색 대상 필드가 확정돼야 설계할 수 있다. 계약 자체가 그 필드를 미정으로 두었으므로 지금 고르면 두 번 만들게 된다.
- `summary`를 페이지 기준이 아니라 전체 기준으로 둔 건 UI 용도(탭 배지)가 그렇기 때문이다. 페이지 기준이면 2페이지에서 배지가 바뀐다.
- 정렬 필드명을 모듈 안에 가둔 이유: `PageRequest.of(page, size, Sort.by("requestedAt"))`를 curriculum이 만들면 enrollment 엔티티 필드명이 사실상 공개 계약이 된다.

## 대안
| 대안 | 장점 | 단점 |
|---|---|---|
| (선택) 단일 엔드포인트 + status 필터 + 전체기준 summary | 계약과 일치, 탭 UI 그대로 대응 | summary 쿼리 1회 추가 |
| 기존 두 엔드포인트 유지 + 각각 페이지화 | 변경 작음 | 계약 불일치, 상태가 늘 때마다 엔드포인트가 늘어남 |
| `q`를 auth에서 userId 목록 뽑아 `IN`으로 전달 | 경계 유지 | 검색 대상 필드 미정 상태로 만들면 재작업, `IN` 목록이 커지면 성능 절벽 |
| `summary`를 items에서 계산 | 쿼리 1회 절약 | 전체를 적재해야 하므로 페이징의 의미가 사라짐 |
| `allowedTransitions`를 `EnrollmentStatus`에 두기 | 재사용 | 강사용 부분집합이라 상태기계 전이표와 어긋나 오해를 부름 |

## 영향·후속
- **파괴적 변경**: `GET .../enrollments`의 응답이 배열 → 봉투로 바뀌고 `/enrollments/active`가 사라진다. 필드도 `studentName`/`studentEmail` → `student.displayName`/`student.email`로 이동. FE는 아직 이 엔드포인트를 붙이지 않았으므로 지금이 바꿀 시점이다. FE 리드 **윤광혁**에게 공유한다.
- **계약 대비 추가 필드**: 항목의 `enrolledAt`(기존 응답이 내려주던 값, 유지), `summary.rejected`·`summary.cancelled`.
- **계약 대비 미구현**: `q`. 도입 시 이 ADR을 대체하는 후속 ADR로 검색 대상 필드와 경계 처리 방식을 확정한다.
- **계약 테스트**: `EnrollmentContractTest`가 페이징(page/size/totalElements/totalPages/hasNext), 혼합 상태 summary, `status` 필터·생략, 중첩 `student` 보강, 상태별 `allowedTransitions`, 비소유 403, 없는 커리큘럼 404를 검증한다. 함께 비어 있던 강사 거절/제적 해피패스와 각각의 잘못된 상태 409, 학생 본인 수강 취소(`DELETE /api/curriculums/{id}/enrollments/me`)도 채웠다.
- **미구현으로 남는 것**: §8.2의 `PATCH .../enrollments/{enrollmentId}`(상태 변경 단일 엔드포인트)는 여전히 `POST .../approve|reject|revoke` 세 개로 나뉘어 있다 — 이번 범위 밖이며 별도로 정리한다.
