# CP0 — 협의 필요 항목 (FE/AI 계약)

> 응답·요청 형태가 다른 팀 코드와 맞물려 백엔드 단독으로 확정할 수 없는 것들.

| # | 항목 | 쟁점 | 상대 |
|---|---|---|---|
| 1 | **인증 식별자 `email` vs `loginId`** | DDL·FE 코드·BE 구현은 email인데 계약 문서 `docs/frontend/api/API_MAP.md`만 loginId. 사실상 email로 굳었고 문서 정합만 남음. | FE |
| 2 | **viewerContext** | 목록·상세 카드의 `relationship`·`allowedActions`·`progress`·`nextLesson` 응답 형태. FE 화면이 소비. | FE |
| 3 | **수강(enrollment) API 형태** | 신청·승인·취소 요청/응답 계약. 상태 전이 규칙과 별개로 API 형태를 FE와 맞춰야 함. | FE |
| 4 | **순서 저장(STRUCTURE-01) 페이로드** | 섹션·레슨 전체 순서를 한 번에 저장하는 요청 형태. FE 편집 화면과 맞물림. | FE |
| 5 | **커리큘럼 lifecycle 정책** | FE가 발행·모집·종료·삭제 API를 정책 확정 전 보류로 명시(`CURRICULUM_MANAGEMENT.md` §9), §10-3에 협의 항목으로 올림. FE 선호: 일반 수정과 분리된 command endpoint + **발행 전 "영향 요약"**. **BE 최소 구현 완료**(발행 DRAFT→PUBLISHED, 보관 PUBLISHED→ARCHIVED, `CURRICULUM_STATE_CONFLICT`). 미확정: **발행 전제조건**(예 ≥1 게시 레슨), **모집(enrollment) 상태와의 연동**, **영향 요약**, **발행취소·종료·삭제 정책**. | FE |
| 6 | **채팅 `viewingSessionMs` 미저장** | FE 채팅 요청/응답에 `viewingSessionMs`(되감기 중 보던 시각)가 있으나 **DDL `chat_message`엔 컬럼이 없다**. BE는 전송 응답에만 반향하고 저장·GET 반환은 안 함. 질문 핀 기준을 `sessionMs`/`viewingSessionMs` 중 무엇으로 할지도 FE 미확정(`LIVE.md`). 컬럼 추가 여부 결정 필요. | FE |
| 7 | **수강생 가명 정책** | FE 명세는 `alias`로 "수강생 12" 같은 **세션별 순차 번호**를 기대. BE 골격은 결정론적 익명 코드(`수강생-XXXX`)만 — 순차 번호는 세션별 카운터가 필요해 보류. 실명·userId 미노출은 이미 지킴. 순차 부여 방식·시점 협의 필요. | FE |
| 8 | **WS `chat_message`의 `userId` → `mine` 불리언으로 대체 제안** | `CONTRACT.md` §3-4 WS 채팅 스키마 `chat_message { lessonId, userId, sessionMs, text, alias }`가 **`userId`를 포함**하나, BE는 프라이버시상 클라로 나가는 payload에서 이를 제거하기를 제안한다(§7과 동일 원칙 — 수강생끼리 서로 익명). **근거**: 다른 학생에게 userId를 브로드캐스트할 실사용 이유가 없다. "내 메시지 판별/색칠"은 `alias`(세션+유저 결정론적 고정키)로 충분하고, userId를 실으면 익명성만 깨진다. **강사 모더레이션(방해자 kick)은 채팅 payload가 아니라 LiveKit identity 기반 서버 처리**라 무관. **다만 "내 메시지 우측 정렬"은 서버가 뷰어별 `mine`(boolean) 필드를 찍어 해결**한다 — WS·REST 모두 인증 요청이므로 서버가 `sender_id == 요청자 userId`를 내부 비교해 `mine`만 내려주면, 새로고침·재접속·**다른 기기 콜드 접속**에서도 clientMessageId 로컬 보관 없이 우측 정렬이 되고 userId는 한 번도 노출되지 않는다. **BE 확정 제안: `userId` 제거 + `mine` 불리언 추가(WS·REST 공통). 반대 의견 있으면 회신 요망.** (REST 응답 `ChatMessageResponse.mine` 구현·검증 완료 — GET 복구 조회에서도 뷰어별 판정. WS 채널은 실시간 채팅 구현 시 동일 규약 적용.) | FE |
