# ADR-0025: 구조 순서 원자 저장(STRUCTURE-01)과 structure_version compare-and-set

> 📍 하네스 개요: [../../harness/README.md](../../harness/README.md) · 아키텍처: [../../ARCHITECTURE.md](../../ARCHITECTURE.md) · 계약: [../../CONTRACT.md](../../CONTRACT.md)

- **상태**: 채택
- **일자**: 2026-07-22
- **관련**: [0017](0017-schema-ownership-core-ai.md), [0018](0018-pk-strategy-uuid-bigint-hybrid.md), [0021](0021-lesson-publish-mvp-direct.md), FE 계약 [docs/frontend/api/CURRICULUM_MANAGEMENT.md](../../frontend/api/CURRICULUM_MANAGEMENT.md) §7

## 맥락
- FE 계약 §7이 `PUT /api/instructor/curriculums/{curriculumId}/curriculum/order`(STRUCTURE-01)를 URL 확정으로 두었으나 구현이 없었다. 섹션·레슨 순서를 바꿀 방법 자체가 없었다.
- `curriculum.structure_version`은 앱이 유지하는 컬럼인데, `InstructorCurriculumService`의 6곳(섹션 생성·삭제, 레슨 생성·삭제·발행·게시취소)에서 **엔티티를 읽어 +1 해서 쓰는(read-modify-write)** 방식이었다. 동시 요청에서 증분이 유실될 수 있고, 무엇보다 "내가 본 버전이 아직 유효한가"를 판정하는 근거로 쓸 수 없었다.
- `uq_section_order(curriculum_id, order_index)`·`uq_lesson_order(section_id, order_index)`는 이미 `DEFERRABLE INITIALLY DEFERRED`다(V1 DDL). 재정렬 중간의 일시적 중복은 커밋 시점에만 검증된다.

## 결정
1. **순서 저장은 전량 교체(full replace) + 단일 트랜잭션.** 요청의 `sections`는 그 커리큘럼의 현재 섹션 집합과 **정확한 순열**이어야 하고, 모든 `lessonIds`의 합집합도 현재 레슨 집합과 정확한 순열이어야 한다. 누락·중복·외부 ID 중 하나라도 있으면 `STRUCTURE_INVALID`(400)로 **전체 실패**하며 부분 적용이 없다. 검증은 어떤 쓰기보다 먼저 끝낸다.
2. **레슨은 같은 커리큘럼 안에서 섹션 간 이동 가능**(lesson.order_index DDL 주석). 다른 섹션 아래로 보내면 `section_id`도 함께 갱신한다.
3. **order_index는 0-based로 0..n-1을 그대로 재배정한다.** DEFERRABLE UNIQUE 덕분에 임시값 셔플이 필요 없다.
4. **structure_version은 JPA `@Version`으로 바꾸지 않는다.** 대신 리포지토리의 원자 UPDATE 두 개를 쓴다.
   - `bumpStructureVersion(id)` — 무조건 +1. 기존 6곳의 read-modify-write를 이걸로 교체한다.
   - `bumpStructureVersionIfMatches(id, expected)` — compare-and-set. 0행이면 그 사이 구조가 바뀐 것이므로 `STRUCTURE_VERSION_CONFLICT`(409).
   둘 다 `@Modifying(flushAutomatically = true, clearAutomatically = true)`다 — 벌크 UPDATE 전에 대기 중인 쓰기를 내보내 트리거와 순서를 맞추고, 이후 조회가 낡은 엔티티를 다시 쓰지 않게 한다.
5. **409 본문은 공용 봉투의 상위집합.** 최신 버전을 실어야 하는데 공용 `ErrorResponse`(code·message·fieldErrors·correlationId)에는 자리가 없다. 커리큘럼 한 곳 때문에 공용 봉투를 늘리는 대신, 봉투를 그대로 복사하고 `structureVersion` 한 칸만 더한 `StructureConflictResponse`를 이 케이스에만 쓴다. FE는 평소처럼 `code`로 분기하고 `structureVersion`에서 최신 버전을 바로 읽는다(message에도 같은 값이 들어간다).
6. **레슨 데이터 조작은 lesson 포트로만.** `LessonManagement.findBySections`(상태 무관 조회)·`applyPlacements(List<LessonPlacement>)`를 추가했다. 소유권·범위 검증은 curriculum이 하고 lesson은 데이터만 쓴다([0017] 경계 유지).
7. **DB 마이그레이션 없음.** 컬럼·제약이 이미 갖춰져 있어 순수 코드 변경이다.

## 근거
- `@Version`은 "아무 변경이나" 충돌로 본다. 여기 필요한 건 **구조 변경에 한정된** 버전이고, `Curriculum`은 트리거가 유지하는 카운터 컬럼 때문에 `@DynamicUpdate`에 의존한다 — 낙관적 락을 얹으면 트리거가 쓴 값과 엔티티 상태가 엮여 오탐이 생긴다.
- 컬럼 기준 원자 증가는 read-modify-write의 증분 유실을 구조적으로 없앤다. CAS는 같은 원리를 그대로 재사용하므로 코드가 하나의 규약으로 정리된다.
- 전량 교체는 diff/patch보다 검증이 단순하고("정확한 순열이냐") FE의 드래그 앤 드롭 결과와 1:1로 대응한다.

## 대안
| 대안 | 장점 | 단점 |
|---|---|---|
| (선택) 원자 UPDATE + CAS | 증분 유실 없음, 구조 변경에만 반응, 트리거·@DynamicUpdate와 무충돌 | 벌크 UPDATE라 영속성 컨텍스트를 비워야 함(clearAutomatically) |
| JPA `@Version` | 표준·자동 | 구조 무관 변경까지 충돌 처리, 트리거 카운터·@DynamicUpdate와 상호작용이 불투명 |
| 부분(delta) 순서 저장 | 페이로드 작음 | 중간 상태 검증이 복잡하고 동시 편집 시 결과가 비결정적 |
| 409 본문에 최신 버전 생략(message로만) | 공용 봉투 유지 | FE가 문자열 파싱하거나 재조회 왕복이 한 번 더 필요 |

## 영향·후속
- **FE 계약 편차(조율 필요)**: 문서 §7 예시는 `order`를 **1-based**(1, 2)로 적었으나 구현은 **0-based**다. 기존 조회 API(`SectionResponse.orderIndex`·`LessonView.order`·`OutlineLesson.order`)가 이미 0-based 원본 `order_index`를 그대로 노출하고 `nextOrder`도 0에서 시작한다 — 한 화면 안에서 순서 값이 API마다 달라지는 쪽이 더 나쁘므로 내부 일관성을 택했다. FE 리드 **윤광혁**에게 공유하고, 1-based로 통일하기로 하면 조회 API까지 함께 옮긴다(단독 변경 금지).
- **응답 본문 편차**: 409는 공용 오류 봉투에 `structureVersion`이 하나 더 붙은 형태다(위 결정 5).
- **계약 테스트**: `StructureReorderContractTest`가 순서 저장 200+버전 증가+강사/공개 목차 반영, 섹션 간 레슨 이동, 빈 구조 저장, stale baseVersion 409(최신 버전 동봉), 섹션·레슨 각각의 누락/중복/외부 ID 400(아무것도 안 바뀜), 비소유자 403, 없는 커리큘럼 404를 검증한다.
- **후속**: 동시 재정렬의 실제 경합(두 트랜잭션 동시 커밋)은 커밋 시점 DEFERRABLE 제약 위반으로 `CURRICULUM_STRUCTURE_CONFLICT`(409)가 되는 경로가 남아 있다 — CAS가 먼저 걸리는 것이 정상이며, 두 경로 모두 409라 FE 동작은 같다.
- **동시 레슨 생성 ↔ 섹션 간 이동**: `nextOrder`는 자기 스냅샷의 `max(order_index)+1`을 쓰므로, 다른 트랜잭션이 같은 섹션으로 레슨을 옮기는 재정렬과 겹치면 커밋 시점에 `uq_lesson_order`가 걸려 409(`CURRICULUM_STRUCTURE_CONFLICT`)가 난다. CAS는 `curriculum.structure_version`만 지키지 레슨 행을 잠그지 않기 때문이다. 데이터 손상은 없고 재시도로 해소되는 열화라 MVP에선 허용한다 — 섹션 간 이동이 생기면서 도달 가능해진 경로라 여기 남긴다.
- **`curriculum.updated_at` 동작 변화**: 예전엔 구조 변경이 엔티티를 더럽혀 `@UpdateTimestamp`가 같이 갱신됐지만, 이제 벌크 UPDATE가 `structure_version`만 쓰므로 섹션·레슨 추가/삭제/발행으로는 `updated_at`이 움직이지 않는다(기본정보 수정에만 반응). 구조 변경 시각이 필요하면 `structure_version` 증가를 신호로 쓰거나 별도 컬럼을 두어야 한다.
- **롤백 보장 검증**: 409는 이미 flush된 순서 변경을 트랜잭션 롤백에 의존해 되돌린다. `@Transactional` 계약 테스트로는 (참여 트랜잭션이라) 증명할 수 없어, 비-`@Transactional` 커밋 테스트 `StructureReorderRollbackVerifyTest`를 따로 두어 실제 커밋 경계에서 되돌아가는지 확인한다.
