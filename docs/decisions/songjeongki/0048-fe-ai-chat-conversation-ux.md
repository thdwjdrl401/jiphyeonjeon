# ADR-0048: FE 개인 AI 질의응답 — 단발 폼에서 대화형(챗) UX로, 이력은 클라이언트 메모리만

> 📍 하네스 개요: [../../harness/README.md](../../harness/README.md) · 아키텍처: [../../ARCHITECTURE.md](../../ARCHITECTURE.md) · 계약: [../../CONTRACT.md](../../CONTRACT.md)

- **상태**: 채택 (FE 구현)
- **일자**: 2026-07-30
- **관련**: [0047](0047-live-ai-answer-sse-proxy.md)(라이브 AI 답변 SSE 프록시 계약), FE 문서 `docs/frontend/components/LIVE_LESSON.md` §4.3, `docs/frontend/api/LIVE.md` §10.1
- **오너 경계**: FE 전용(패널 UX·클라이언트 상태). 서버 계약(`POST /live-sessions/{id}/ai/answers/stream`, 이벤트 4종)은 **그대로** 쓰며 새 API를 요구하지 않는다.

## 맥락

`PersonalAiQuestionPanel`이 "질문 1건 → 답변 1건"만 붙잡는 단발 폼이라 사용성이 나빴다. 실제로 보고된 문제는 네 가지다.

1. Enter로 전송되지 않고 버튼을 눌러야 했다(라이브 채팅 입력은 이미 Enter 전송이라 규약도 어긋났다).
2. 전송해도 **내 질문이 화면에 없었다** — 답변 블록만 그렸다.
3. 전송 후에도 textarea에 질문이 남아, 다시 물으려면 직접 지워야 했다.
4. 새 질문을 하면 리듀서가 `emptyAiAnswerState`로 리셋돼 **이전 답변이 사라졌다**.

또한 빈 상태(영실 캐릭터)가 `status === 'idle'` 기준이라 답변이 온 뒤에도 화면 위에 남아 있었다.

서버 제약이 하나 있다: **AI Q&A 이력 API가 없다**(`AI-HISTORY-01` 제안 상태, `docs/frontend/api/VOD_LEARNING_AI.md`). 즉 이력은 FE가 들고 있는 동안만 존재한다.

## 결정

### 1. 턴 목록을 상태의 1급 시민으로 — 턴 상태는 기존 리듀서 재사용

`aiConversation.ts`에 `AiConversationState { turns: AiConversationTurn[] }`를 둔다. `AiConversationTurn`은 **기존 `AiAnswerState`를 그대로 확장**(`+ id`)하고, 턴 하나의 전이는 기존 `reduceAiAnswer`에 위임한다. 대화 리듀서가 정하는 것은 "어느 턴에 이벤트를 흘릴지"뿐이다 — 델타 누적, terminal 3분기(`done`/`insufficient`/`error`), `retryable` 판정, terminal 없는 종료 처리는 계약대로 이미 고정돼 있어 두 번 구현하지 않는다.

액션은 `ask`(끝에 추가) / `retry`(그 자리에서 같은 질문으로 되돌림) / `cancel`(스트리밍 턴 하나) / `turn`(지목 턴에 답변 액션 위임)이다. 스트리밍 중인 턴이 있으면 `ask`·`retry`를 **리듀서가 거부**한다 — 화면 비활성화와 별개로 상태 수준에서 겹침을 막는다.

### 2. 낙관적 질문 표시 + 입력창 즉시 비우기

`submit`은 `dispatch({kind:'ask'})` → `setQuestion('')` → 스트림 시작 순서다. 서버 응답을 기다리지 않고 내 말풍선이 먼저 올라간다. 스트림 시작 전 실패(HTTP 오류 봉투)도 **그 턴의 오류**로 표시되므로, 낙관적 표시가 사라지지 않고 재시도 지점이 명확하다.

### 3. Enter 전송은 IME 검사를 먼저

`event.key === 'Enter' && !event.nativeEvent.isComposing`일 때만 전송하고, `Shift+Enter`는 기본 동작(줄바꿈)으로 흘린다. 한글 조합 확정 Enter를 전송으로 받으면 미완성 질문("안녕하세")이 그대로 나가므로, 라이브 채팅 입력(`LiveClassroomPage.handleMessageKeyDown`)과 **같은 규칙**을 쓴다. 채팅은 `Ctrl+Enter` 줄바꿈이지만 AI 패널은 긴 질문이 흔해 `Shift+Enter`(일반 챗 관례)를 택했다.

### 4. 응답 중에는 전송 자리를 중단으로 교체

370px 사이드바에 버튼을 늘리지 않기 위해, 스트리밍 중 `전송`(submit) 버튼을 `답변 중단`(button, `AbortController.abort()`)으로 바꾼다. 중단은 실패가 아니라 `cancelled` 턴으로 남고 받은 조각·질문은 이력에 유지된다.

### 5. 하단 추종 스크롤은 "하단 근처일 때만"

이력 영역(`.ai-chat-log`)을 자체 스크롤로 두고 입력창을 아래에 고정한다(채팅 패널과 같은 골격). 새 델타·새 턴마다 하단으로 붙이되, 하단에서 48px 이상 올라가 있으면(=읽는 중) 건드리지 않고 `↓ 최신 답변으로 이동` 버튼을 띄운다 — 채팅 패널의 `chat-latest-jump`와 같은 값·같은 클래스를 재사용한다.

### 6. 렌더 억제는 참조 안정성으로

`applyToTurn`이 **바뀐 턴만 새 객체로 갈고 나머지는 같은 참조로 되돌린다.** 턴 컴포넌트(`AiChatTurn`)는 `memo`이고 props는 `{turn, onRetry}`(콜백은 `useCallback`으로 고정)뿐이라, 델타 하나에 지난 턴들이 다시 그려지지 않는다. 입력창 타이핑도 같은 이유로 이력을 재렌더하지 않는다. 그 이상(가상 스크롤 등)은 하지 않는다.

### 7. 이력 범위는 화면에서 정직하게 밝힌다

`AI-HISTORY-01`이 없으므로 이력을 localStorage·서버에 저장하지 **않는다.** 대신 입력창 옆에 "대화는 이 화면에서만 유지되며 새로고침하면 사라집니다."를 상시 노출한다. "저장됨"으로 읽힐 문구는 쓰지 않는다.

## 근거

- **계약을 늘리지 않는다**: 서버 이벤트·엔드포인트 그대로다. 챗 UX는 순수 FE 상태 구조 변경이라 BE 합의를 기다릴 이유가 없다.
- **분기 중복 제거**: 답변 상태 전이를 `reduceAiAnswer` 한 곳에 남겨 두면 계약 변경(예: 새 terminal) 때 고칠 자리가 하나다. 대화 리듀서는 라우팅만 한다.
- **오전송 방지**: IME 검사가 없으면 한글 사용자에게 최악의 버그(미완성 질문 전송)가 상시 발생한다. 채팅과 같은 패턴을 복제해 규약을 하나로 유지했다.
- **정직성**: 이력이 남는 것처럼 보이는 UI에서 새로고침으로 사라지면 신뢰를 잃는다. 지속성 없음을 UI가 직접 말한다.

## 테스트

`src/test/features/ai/aiConversationState.test.ts`(순수 리듀서: 턴 누적·참조 안정성·겹침 거부·재시도 제자리 복귀·취소·미지 턴 무시)와 `src/test/features/ai/PersonalAiQuestionPanel.test.tsx`(Enter 전송, IME 조합 중 Enter 무전송, Shift+Enter 줄바꿈, 입력창 비움 + 즉시 표시, 델타 누적, terminal 3종, 다중 턴 유지, 재시도/비재시도, 중단, 미지원 모드, trim)로 고정한다. 화면 연결은 `src/test/integration/LiveAiQuestion.test.tsx`가 Enter 경로로 확인한다.

## 남은 이슈

- **이력 미영속**: 새로고침·탭 이동(패널 언마운트)이면 대화가 사라진다. 서버 이력이 필요하면 `AI-HISTORY-01`(라이브 스코프 포함)을 계약으로 올려야 한다 — 그때 세션 스코프 인가(ADR-0047 §1b)와 보존 기간을 함께 정한다.
- **다시보기**: `ask`가 없는 미지원 모드는 그대로다(ADR-0047 §9의 시간축 문제 미해결).
- **질문 핀 연동**: "개인 AI 질문을 강사 질문 핀에 포함"(LIVE_LESSON.md §4.4)은 여전히 서버 몫이라 FE 이력과 무관하다.
