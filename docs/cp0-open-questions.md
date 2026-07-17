# CP0 — 협의 필요 항목 (FE/AI 계약)

> 응답·요청 형태가 다른 팀 코드와 맞물려 백엔드 단독으로 확정할 수 없는 것들.

| # | 항목 | 쟁점 | 상대 |
|---|---|---|---|
| 1 | **인증 식별자 `email` vs `loginId`** | DDL·FE 코드·BE 구현은 email인데 계약 문서 `docs/frontend/api/API_MAP.md`만 loginId. 사실상 email로 굳었고 문서 정합만 남음. | FE |
| 2 | **viewerContext** | 목록·상세 카드의 `relationship`·`allowedActions`·`progress`·`nextLesson` 응답 형태. FE 화면이 소비. | FE |
| 3 | **수강(enrollment) API 형태** | 신청·승인·취소 요청/응답 계약. 상태 전이 규칙과 별개로 API 형태를 FE와 맞춰야 함. | FE |
| 4 | **순서 저장(STRUCTURE-01) 페이로드** | 섹션·레슨 전체 순서를 한 번에 저장하는 요청 형태. FE 편집 화면과 맞물림. | FE |
| 5 | **커리큘럼 lifecycle 정책** | FE가 발행·모집·종료·삭제 API를 정책 확정 전 보류로 명시(`CURRICULUM_MANAGEMENT.md` §9), §10-3에 협의 항목으로 올림. FE 선호: 일반 수정과 분리된 command endpoint + **발행 전 "영향 요약"**. **BE 최소 구현 완료**(발행 DRAFT→PUBLISHED, 보관 PUBLISHED→ARCHIVED, `CURRICULUM_STATE_CONFLICT`). 미확정: **발행 전제조건**(예 ≥1 게시 레슨), **모집(enrollment) 상태와의 연동**, **영향 요약**, **발행취소·종료·삭제 정책**. | FE |
