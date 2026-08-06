# ADR-0003: 레슨 자료 = PPTX 전용 + 초기 복수·이후 단일 증분 처리

> 레슨 폼: [LESSON_FORM.md](../../frontend/components/LESSON_FORM.md) · API 초안: [LESSON_MANAGEMENT.md](../../frontend/api/LESSON_MANAGEMENT.md) · 현행 발행 결정: [seominkyeong/0005](../seominkyeong/0005-lesson-has-no-draft-state.md) · 자료 연결: [songjeongki/0035](../songjeongki/0035-lesson-material-attach.md)

- **상태**: 부분 대체 — PPTX·파일별 연결 원칙은 구현, 레슨 발행 게이트는 폐기
- **일자**: 2026-07-21
- **적용 범위**: 레슨 PPTX 자료, AI ingestion, 게시 이후 자료 변경

> **2026-08-06 현행 정합화**: 레슨은 더 이상 `DRAFT`나 별도 발행 상태를 갖지 않고 생성 즉시
> `PUBLISHED`다([seominkyeong/0005](../seominkyeong/0005-lesson-has-no-draft-state.md)). 따라서 아래
> 결정 4·11의 “자료/AI 준비를 레슨 게시 게이트로 사용한다”는 부분은 대체됐다. PPTX는 presigned
> 업로드 뒤 자료를 한 건씩 연결·삭제하는 계약으로 구현됐고, 임베딩과 핵심 용어는 자료별 독립 상태로
> 추적한다. 자료 준비 여부가 레슨의 `status`를 바꾸지는 않는다.

## 맥락

자료 형식은 Markdown, Markdown+PDF, PPTX 후보를 거쳤고 최종적으로 데모에서 사용할 자료를 PPTX로 제한했다. 자료 변경 방식도 한 번에 삭제·재업로드 후 전체 임베딩하는 안과, 파일 하나의 변경만 반영하는 안을 검토했다.

전체 재처리는 구현은 단순하지만 자료가 늘수록 비용과 대기 시간이 커지고, 관계없는 AI 근거·검수 결과까지 흔들린다. 반면 파일 계보를 유지하면 추가·삭제 영향만 처리할 수 있다.

## 결정

1. 레슨 자료는 초기 범위에서 **PPTX만 허용**한다. 영상 업로드는 제공하지 않는다.
2. 자료는 특정 레슨에 귀속한다. 커리큘럼 관리 화면은 자료 상태 요약과 레슨 수정 이동만 제공한다.
3. 레슨당 PPTX 개수 제한은 두지 않는다. 파일별 최대 크기는 API 협의 항목이다.
4. 기본 정보만으로 `DRAFT`를 만들 수 있지만, 자료 없이 AI 준비·게시·라이브 시작을 완료할 수 없다.
5. 최초 준비는 필요한 PPTX를 **복수 선택·업로드**하고, 강사가 초기 AI 준비를 명시적으로 시작한다.
6. 초기 준비 이후에는 별도 “변경 적용” 묶음 없이 자료를 **한 파일씩 즉시 추가·삭제**한다.
7. 추가 자료는 해당 파일만 파싱·chunk·embedding하여 기존 검색 범위에 증분 추가한다.
8. 삭제 자료는 해당 `materialId`의 chunk·embedding만 제거한다.
9. 삭제 자료를 직접 참조한 근거와 AI 산출물만 무효화·재생성하고, 관계없는 결과와 강사 검수 결과는 유지한다.
10. 하나의 자료 작업이 끝나기 전 다음 자료 작업을 시작하지 않는 것을 기본으로 한다.
11. 게시된 레슨의 자료가 바뀌면 제품 목표상 AI 재준비와 강사 재확인이 필요하다.
12. 자료는 레슨 시작 전부터 수강생에게 공개할 수 있다. 수강생은 활성 자료만 보고, 강사는 처리 상태까지 본다.
13. 라이브 중에는 자료를 잠그고, 종료된 레슨의 자료 revision은 후속 범위로 둔다.

## 근거

- PPTX 하나로 제한하면 파서·검증·근거 표시를 먼저 안정화할 수 있다.
- 증분 처리는 전체 재임베딩 비용과 대기 시간을 줄인다.
- `materialId → chunk → embedding → evidence` 계보를 유지하면 삭제 영향과 근거 유효성을 설명할 수 있다.
- 자료 작업을 직렬화하면 충돌·중복 삭제·서로 다른 AI 작업의 경합을 줄인다.

## 대안

| 대안 | 장점 | 단점 |
|---|---|---|
| Markdown 또는 PDF 포함 | 사용자 선택 폭 | 파서·근거 좌표·검증 범위 증가 |
| 자료 변경을 일괄 적용 | 한 번에 검토 | 임시 상태·충돌·전체 재처리 복잡도 |
| 변경 때 전체 재임베딩 | 구현 단순 | 비용·시간 증가, 관계없는 결과 무효화 |
| **PPTX + 파일별 증분(선택)** | 영향 범위 최소, 상태 설명 가능 | 계보·operation 상태 관리 필요 |

## 영향·후속

- presigned upload, 파일별 검증, 비동기 `operationId`, 재시도·멱등 계약이 필요하다.
- 동일 파일 판정, 파일 크기, 일부 업로드 실패 처리 정책을 백엔드와 확정해야 한다.
- [seominkyeong/0005](../seominkyeong/0005-lesson-has-no-draft-state.md)에 따라 레슨 발행·게시취소 endpoint와 AI readiness 발행 게이트는 폐기됐다. 공개 축은 커리큘럼 lifecycle 하나다.
- 커리큘럼 공통 자료는 [ADR-0011](0011-optional-curriculum-materials.md)과 [songjeongki/0042](../songjeongki/0042-curriculum-material-attach-and-embedding-scope.md)에서 별도 scope로 구현됐다. 남은 과제는 커리큘럼 scope 임베딩 잡을 AI worker가 실제 소비하는 경로다.

