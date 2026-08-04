# ADR-0075: 자동 저장은 결과를 쿼리 캐시에도 반영한다 (리마운트 없이)

> 📍 하네스 개요: [../../harness/README.md](../../harness/README.md) · 판단 정책: [../../harness/POLICY.md](../../harness/POLICY.md)

- **상태**: 채택
- **일자**: 2026-08-04
- **관련**: Sub Ⅱ, ADR-0042(커리큘럼 자료 연결)

## 맥락 (Context)

커리큘럼 관리 화면의 자동 저장(ADR-0042)은 저장 결과를 **컴포넌트 로컬 state에만** 반영하고
`['curriculum-management', curriculumId]` 캐시는 건드리지 않았다. 전역 `staleTime`은 30초이고
`refetchOnWindowFocus`는 꺼져 있다(`app/queryClient.ts`).

그래서 저장은 성공했는데 화면만 옛것이 되는 구간이 생겼다. 자료를 올리고 다른 화면에 갔다
돌아오면 올린 자료가 사라져 보이고, 자료를 지우고 돌아오면 지운 자료가 되살아나 보였다.
30초가 지난 뒤 다시 들어가면 refetch가 돌아 맞게 나왔다 — DB는 처음부터 맞았고 표시만 늦었다.

단순히 저장마다 `invalidateQueries`로 refetch를 돌릴 수는 없었다. 관리 화면은 서버 구조가 바뀌면
에디터를 다시 seeding하려고 `key={curriculumId}:{structureKey}`를 쓰는데, 새 섹션이 실제 id를
받는 순간 그 key가 바뀌어 **편집 중인 에디터가 리마운트**된다(방금 입력한 글자와 저장 배지가 날아간다).

## 결정 (Decision)

자동 저장 성공 직후 `syncCacheAfterSave`가

1. `setQueryData`로 캐시의 `curriculum`(기본 정보·`materials`·`structureVersion`)을 저장 결과로 덮고,
2. 같은 키를 `invalidateQueries({ refetchType: 'none' })`로 **stale 표시만** 해서 다음 진입에서 섹션 구조를 다시 읽게 하고,
3. 화면 밖 소비자(`['my-curriculums']`, `['curriculums']`)를 invalidate한다(편집 중에는 비활성이라 요청이 나가지 않는다).

섹션 배열은 캐시에 쓰지 않는다 — 재seed key의 입력값이라 리마운트를 부른다.

## 근거 (Rationale)

- 자료·기본 정보는 재seed key에 들어가지 않으므로 캐시에 바로 써도 리마운트가 없다. 다시 들어올 때 첫 페인트부터 맞다.
- 섹션 구조는 정확성이 다음 진입에서만 필요하다. 그때는 새 마운트라 리마운트 손실 개념이 없다.
- `refetchType: 'none'`이 "지금 고치지 말고 다음에 읽어라"를 정확히 표현한다.

## 대안 (Alternatives)

| 대안 | 장점 | 단점 |
|---|---|---|
| (선택) `setQueryData` + `refetchType: 'none'` | 리마운트 없음, 재진입 첫 페인트부터 정확 | 캐시 갱신 대상을 손으로 골라야 함 |
| 저장마다 전체 `invalidateQueries` | 코드 한 줄 | 새 섹션 저장 때마다 에디터 리마운트 → 입력·배지 유실 |
| `staleTime: 0`으로 낮추기 | 자동 회복 | 모든 화면의 요청량 증가, 근본 원인(캐시 미갱신)은 그대로 |

## 영향·후속 (Consequences)

- 자물쇠: FE 내부 캐시 정책이라 공유 계약이 없어 계약 테스트 대상이 아니다(POLICY 🟢). 대신 왕복 회귀
  테스트를 통합 테스트에 남겼다 — `CurriculumWorkspace.test.tsx`의
  "자료를 자동 저장한 뒤 화면을 떠났다 돌아와도 최신 목록이 보인다"(수정 전에는 실패함을 확인).
- 남은 문제: 대표 이미지는 여전히 자동 저장 대상이 아니다(지문·요청에 `thumbnailUrl`이 없고 고른
  `File`을 버린다). 별도 작업으로 다룬다.
