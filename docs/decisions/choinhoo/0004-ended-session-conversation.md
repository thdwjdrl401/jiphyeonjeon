# ADR-0004: 종료된 라이브 세션에서도 채팅과 AI 질문을 계속 허용한다

> 관련 결정: [ADR-0003 라이브 종료 순차 처리](0003-simple-live-end-sequential-process.md) ·
> [ADR-0047 라이브 AI SSE 프록시](../songjeongki/0047-live-ai-answer-sse-proxy.md) ·
> [ADR-0050 채팅 익명 선택](../songjeongki/0050-chat-anonymity-is-sender-choice.md) ·
> [ADR-0005 학생 HLS·자막 drain](0005-ended-hls-caption-drain.md) ·
> [공유 계약](../../CONTRACT.md) · [프론트 라이브 설계](../../frontend/components/LIVE_LESSON.md)

- **상태**: 채택
- **일자**: 2026-07-31
- **적용 범위**: 종료된 세션의 기존 classroom, 채팅 REST·STOMP, 세션 기반 AI SSE, 학생 UI
- **부분 대체**: ADR-0003의 “`ENDED`부터 채팅·AI 질문을 잠근다”는 상호작용 정책
- **부분 개정됨**: [songjeongki/0113](../songjeongki/0113-post-end-chat-has-nowhere-to-land.md) —
  **채팅**은 `ENDED`에서 다시 닫혔다(그때 쓴 글은 `sessionMs`가 영상 길이를 넘어 다시보기에서
  보이지 않는다). **AI 질문 허용은 이 문서대로 유지된다.**
- **후속 개정**: 학생 HLS·자막 종료 판단은 ADR-0005가 정본

## 맥락

기존 구현은 `ENDED`를 라이브 송출 종료와 세션 대화 종료에 함께 사용했다. 학생 화면은
`session.ended`를 받으면 채팅 입력과 AI 질문을 잠그고 진행 중 AI SSE도 중단했으며, 서버도
채팅 저장과 AI 업스트림 호출 전에 `409 LIVE_SESSION_INTERACTION_CLOSED`를 반환했다.

그러나 `ENDED` 뒤에도 사용자는 같은 classroom에서 다음 활동을 자연스럽게 이어갈 수 있다.

- 방금 수업 내용에 대한 후속 질문과 수강생 간 토론
- 저장된 전체 자막을 근거로 한 AI 복습 질문
- 종료 직전에 시작한 AI 답변의 수신과 재시도

이 활동은 새로운 오디오·자막이나 LiveKit Room을 필요로 하지 않는다. 따라서 송출 수명주기와
대화 가능 여부를 같은 상태로 닫을 이유가 없다.

## 결정

### 1. 세션 대화는 `LIVE`·`ENDING`·`ENDED`에서 허용한다

- 일반 채팅: REST `POST /api/live-sessions/{sessionId}/messages`와 STOMP
  `/app/live-sessions/{sessionId}/chat`
- AI 질문: `POST /api/live-sessions/{sessionId}/ai/answers/stream`

소유 강사 또는 활성 수강생이라는 기존 접근 게이트는 그대로 유지한다. `DRAFT`·`SCHEDULED`·`OPEN`·
`STARTING`·`CANCELLED`·`FAILED`에서는 아직 시작된 대화 공간이 아니므로
`409 LIVE_SESSION_STATE_CONFLICT`를 반환한다.

기존 `LIVE_SESSION_INTERACTION_CLOSED` 오류는 현재 계약에서 제거한다. `ENDED`가 더 이상 오류 조건이
아니고, 다른 비허용 상태는 기존 상태 충돌 코드로 충분하기 때문이다.

### 2. 학생 화면은 송출 종료와 대화·미디어 상태를 분리한다

`session.ended` 또는 최초 REST 조회의 `ENDED`를 받으면 다음을 적용한다.

- **유지**: 채팅 입력·전송, AI 질문·재시도, 진행 중 AI SSE, 기존 채팅·AI 대화
- **미디어 유지**: 별도 송출 종료 안내 없이 재생 중인 HLS, 자막 노출과 자막 시각 이동
- **별도 종료 신호**: 새 자막 생성은 `caption.stream.completed`, HLS 확정은
  `VideoAsset READY/FAILED`, 학생 재생 완료는 player `ended`

자막 WebSocket은 Room 삭제 뒤 남은 자막과 `caption.stream.completed`를 받기 위해 유지한다.

### 3. 종료된 classroom AI와 다시보기 AI는 다른 범위다

이번 결정은 기존 `sessionId` 기반 라이브 AI endpoint를 `ENDED` 상태에서도 사용하는 것이다.
문맥은 해당 세션에 저장된 최신 자막의 raw `streamElapsedMs`다.

다시보기 플레이어의 임의 `sessionMs`를 AI 문맥으로 보내는 기능은 여전히 별도 문제다. 세션-ms와
STT attempt-local 시간축의 역변환 계약이 없으므로 ADR-0047 §9의 replay AI 미구현 결정은 유지한다.

## 결과

### 얻는 것

- 라이브 종료가 대화를 갑자기 끊지 않는다.
- 종료 직전 시작된 AI 답변이 취소되지 않는다.
- 저장된 자막을 이용해 같은 세션에 대한 복습 질문을 이어갈 수 있다.
- 채팅은 기존 DB·WebSocket 경로를 그대로 사용하므로 새 DTO나 채널이 필요 없다.

### 감수하는 것

- 활성 수강 관계가 유지되는 동안 종료된 세션에도 새 채팅이 계속 쌓인다. 별도의 토론 마감 시각이나
  강사 잠금 기능이 필요해지면 세션 생명주기와 분리된 정책 필드로 추가해야 한다.
- AI 대화 이력은 여전히 브라우저 메모리뿐이어서 새로고침하면 사라진다. 이번 결정은 새 질문 가능
  상태만 넓히며 AI 이력 저장 계약을 추가하지 않는다.

## 계약 검증

공유 경계를 바꾸므로 FE·BE 계약 테스트를 함께 갱신한다.

- `ENDING`과 `ENDED`에서 채팅 생성이 201이고 복구 조회에 포함된다.
- `ENDING`과 `ENDED`에서 AI SSE가 업스트림을 호출하고 200으로 시작된다.
- 시작 전 상태에서는 채팅·AI가 409 `LIVE_SESSION_STATE_CONFLICT`이고 AI 업스트림을 호출하지 않는다.
- `ENDED` 학생 classroom은 별도 종료 안내 없이 HLS·자막과 채팅·AI 입력을 유지한다.
- 자막과 HLS의 종료 판단은 ADR-0005의 독립 상태축을 따른다.
