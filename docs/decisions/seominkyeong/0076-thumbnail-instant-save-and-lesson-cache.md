# ADR-0076: 대표 이미지는 고른 즉시 저장하고, 강의 쓰기는 그 강의 쿼리까지 무효화한다

> 📍 하네스 개요: [../../harness/README.md](../../harness/README.md) · 판단 정책: [../../harness/POLICY.md](../../harness/POLICY.md)

- **상태**: 채택
- **일자**: 2026-08-04
- **관련**: Sub Ⅱ, [ADR-0075](0075-autosave-syncs-query-cache.md)(자동 저장 캐시 동기화), ADR-0042(커리큘럼 자료)

## 맥락 (Context)

ADR-0075로 커리큘럼 자료의 "저장은 됐는데 화면만 옛것" 문제를 고친 뒤, 같은 증상을 두 곳에서 더 찾았다.
원인은 서로 다르다.

**대표 이미지(커리큘럼 관리 > 기본 정보)** — 캐시가 아니라 **저장 자체가 없었다**.
`CurriculumImageField`가 주는 `{ file, previewUrl }`에서 화면은 `previewUrl`만 로컬 state에 넣고 `file`을
버렸고, `thumbnailUrl`은 자동 저장 지문에도, 저장 요청 본문에도 없었다. 헤더는 "변경 사항이 자동
저장됩니다"라고 말하는데 이미지는 어디에도 저장되지 않아, 다시 들어오면 옛 이미지로 돌아갔다.
서버는 이미 지원한다 — `PATCH /api/instructor/curriculums/{id}`의 `thumbnailAssetId`
(`InstructorCurriculumService.updateBasicInfo` → `applyThumbnail`, 소유·종류·상태 위반은 409).

**개별 강의 수정(강의 자료)** — `invalidateAfterLessonWrite`가 커리큘럼 쪽 투영만 무효화하고
**그 강의 자신을 읽는 쿼리(`instructor-lesson-form`, `lesson`)는 빠져 있었다**. 코드베이스 어디에서도
이 두 키를 무효화하지 않아, 자료를 올리거나 지운 뒤 폼·상세를 다시 열면 staleTime(30초) 동안 저장 전
목록이 보였다. 더 나쁜 부작용도 있었다: 수정 저장은 화면을 떠나지 않는데 로컬 목록이 서버 진실로
교체되지 않아 올린 파일이 계속 "업로드 대기"로 남고, 그 상태로 다시 저장하면 **같은 자료가 한 번 더**
업로드·연결됐다.

## 결정 (Decision)

1. **대표 이미지는 고른 즉시 저장한다.** 선택 → `uploadAsset(THUMBNAIL)` → `PATCH { thumbnailAssetId }`
   → 서버가 준 URL로 미리보기 교체 → 캐시 동기화(ADR-0075의 경로 재사용). 실패하면 미리보기를 되돌리고
   저장 실패를 알린다. 자동 저장 지문에는 넣지 않는다.
2. **`invalidateAfterLessonWrite(queryClient, curriculumId, lessonId?)`** — `lessonId`를 주면
   `['instructor-lesson-form', lessonId]`와 `['lesson', lessonId]`도 무효화한다. 강의 저장과 자료 삭제가
   모두 이 경로를 쓴다. 저장 성공 직후 로컬의 File 보유 항목을 떼고, 뒤따르는 refetch가 실제
   `materialId`로 채운다.
3. **대표 이미지 삭제 버튼은 자리를 지키되 비활성**으로 두고 이유를 말한다. 커리큘럼 만들기에서는
   저장 전이라 실제로 동작하고(로컬 선택 취소), 관리 화면에서는 서버 계약이 없어 비활성이다.

## 근거 (Rationale)

- 파일 선택은 타이핑처럼 이어지는 입력이 아니라 한 번의 사건이라 디바운스가 주는 이득이 없다. 게다가
  지문이 저장 전(파일 이름·크기)과 후(서버 URL)로 달라, 지문 경로에 태우면 저장이 한 번 더 도는 것을
  막을 마땅한 방법이 없다(자료는 `fileName:fileSize`가 저장 전후 같아 그 문제가 없었다).
- 썸네일 PATCH는 `thumbnailAssetId`만 싣는다. 나머지 필드는 null=변경 안 함이라 자동 저장이 방금 보낸
  제목·소개를 되돌리지 않는다.
- 강의 쪽은 무효화 하나가 세 증상(폼·상세 지연, 업로드 대기 잔류, 중복 업로드)을 함께 없앤다. 저장
  경로가 `await`으로 refetch까지 기다리므로, 버튼이 다시 눌릴 수 있게 되는 시점엔 목록이 이미 최신이다.
- 삭제 버튼을 감추면 "삭제할 수 있나"를 화면에서 알 수 없고, 그대로 두면 눌러도 아무 일이 없는 거짓
  동작이 된다. 자리를 두고 이유를 말하는 편이 둘보다 정직하다.

## 대안 (Alternatives)

| 대안 | 장점 | 단점 |
|---|---|---|
| (선택) 썸네일 즉시 저장 | 지문 루프 없음, 피드백 즉시 | 저장 경로가 둘(디바운스/즉시)로 갈린다 |
| 썸네일을 자동 저장 지문에 포함 | 저장 경로가 하나 | 저장 전후 지문이 달라 불필요한 재저장이 돈다 |
| (선택) `lessonId` 옵션 인자 | 호출부가 범위를 고른다 | 인자를 빠뜨리면 조용히 옛 동작이 된다 |
| 항상 `['lesson']` 전체 무효화 | 빠뜨릴 수 없다 | 한 강의를 저장했다고 남의 강의까지 다시 읽는다 |

## 영향·후속 (Consequences)

- 자물쇠: FE 내부 캐시·저장 흐름이라 공유 계약이 아니다(POLICY 🟢). 회귀 테스트로 잠갔다 —
  `CurriculumWorkspace.test.tsx`(대표 이미지 왕복 유지, 삭제 버튼 상태 2건)와
  `lessonQueryCache.test.ts`(강의 자신 쿼리 무효화, 다른 강의 비오염). 대표 이미지 테스트는 수정 전에
  실패함을 확인했다.
- 레슨 자료 왕복은 통합 테스트로 잠그지 못한다 — 목 서비스가 레슨 자료를 저장하지 않는다
  (`mockLessonService.saveLesson`은 알림 발행에만 쓴다). 그래서 무효화 계약을 단위 테스트로 고정했다.
- **후속 해소(2026-08-05, 서버)**: [ADR-0077](0077-material-integrity-backend-contract-request.md) 요청 5로
  `DELETE /api/instructor/curriculums/{id}/thumbnail` 계약과 백엔드 구현이 추가됐다(멱등 204).
- **후속 해소(2026-08-06, 화면)**: 위 항목은 FE 연결까지 끝난 것처럼 적혀 있었으나 **실제로는 서버만
  들어와 있었다.** 관리 화면은 `THUMBNAIL_REMOVE_PENDING_REASON`과 `if (!selection) return`을 그대로
  들고 있었고, 회귀 테스트도 "비활성 + 준비 중" 쪽을 고정하고 있어 어긋남이 드러나지 않았다. 그래서
  강사에게는 **계약이 생긴 뒤로도 누를 수 없는 버튼**이 남아 있었다. 이번에 결정 3을 뒤집어
  `deleteCurriculumThumbnail`을 서비스 3층(interface·http·mock)에 붙이고 즉시 저장과 같은 경로
  (낙관적 미리보기 → 실패 시 복원 → 캐시 동기화)로 연결했으며, 옛 테스트는 뒤집어 다시 잠갔다.
