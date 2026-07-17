# CP0 — 협의 필요 항목 (FE/AI 계약)

> 응답·요청 형태가 다른 팀 코드와 맞물려 백엔드 단독으로 확정할 수 없는 것들.

| # | 항목 | 쟁점 | 상대 |
|---|---|---|---|
| 1 | **인증 식별자 `email` vs `loginId`** | DDL·FE 코드·BE 구현은 email인데 계약 문서 `docs/frontend/api/API_MAP.md`만 loginId. 사실상 email로 굳었고 문서 정합만 남음. | FE |
| 2 | **viewerContext** | 목록·상세 카드의 `relationship`·`allowedActions`·`progress`·`nextLesson` 응답 형태. FE 화면이 소비. | FE |
| 3 | **수강(enrollment) API 형태** | 신청·승인·취소 요청/응답 계약. 상태 전이 규칙과 별개로 API 형태를 FE와 맞춰야 함. | FE |
| 4 | **순서 저장(STRUCTURE-01) 페이로드** | 섹션·레슨 전체 순서를 한 번에 저장하는 요청 형태. FE 편집 화면과 맞물림. | FE |
