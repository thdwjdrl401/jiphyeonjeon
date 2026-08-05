# ADR-0046: 대화 기억을 userId만으로 활성화하고 기본 대화 범위를 라이브 세션으로 정함

- **상태**: 구현됨(AI 쪽; Spring의 `userId` 전송 합의는 별도 진행)
- **일자**: 2026-08-05
- **관련**: [jinwoo/ADR-0010](../jinwoo/0010-gms-responses-api-conversation-memory.md)(대화 기억 구현),
  [songjeongki/ADR-0049](../songjeongki/0049-fe-ai-chat-conversation-ux.md)(FE 채팅 UX)

## 배경

ADR-0010은 대화 기억(GMS `previous_response_id` 체이닝)을 구현하면서 활성 조건을
`userId`+`conversationId` **둘 다**로 잡고, `conversationId` 발급 정책(언제 새 대화로
취급할지)을 FE/제품 몫으로 미뤄뒀다. 그 결과:

- Spring은 두 필드 모두 안 보내고, FE에는 `conversationId` 개념 자체가 없다 —
  backend·frontend 전체에 `conversationId` 0건.
- 기능은 운영에서 완전히 비활성 상태로 남았고, "아까 내가 무슨 질문을 했지?"에 현재
  질문을 되울리는 증상이 사용자에게 노출됐다(프롬프트 완화는 별도 수정으로 처리).
- 활성화하려면 "wire 필드 2개 추가 + FE 발급 정책 결정"이라는 두 갈래 합의가 필요했다.

팀 논의에서 대화 단위는 **"사용자 uid × 라이브 세션"**으로 가자는 방향이 이미 나와 있었다.
Redis 키(`{userId}:{sessionId}:{conversationId}`)에 `sessionId`가 이미 들어가 있으므로,
이 단위는 새 식별자 없이 표현 가능하다.

## 결정

1. **활성 조건을 `userId` 하나로 완화한다.** `userId`가 있으면 대화 기억이 활성화되고,
   `conversationId`가 없으면 Redis 키의 세 번째 자리를 고정값 `session`으로 채운다.
   대화 범위는 "그 사용자의 그 라이브 세션"이 된다.
2. **`conversationId`는 덮어쓰기용 선택 필드로 남긴다.** 값이 오면 그 값이 대화 범위가
   된다 — FE가 나중에 "새 대화 시작" 같은 UX를 붙일 때 ai-api 무변경으로 동작한다.
3. **`userId` 없는 요청은 절대 활성화하지 않는다.** `sessionId`는 수강생 전원이 공유하는
   값이라 그것만으로 키를 만들면 다른 학생의 대화가 이어진다(기능 오류 + 프라이버시 사고).
   이 가드는 회귀 테스트로 고정한다.

## 근거

- **합의 표면적이 준다.** Spring에 요청할 wire 변경이 두 필드에서 **`userId` 하나**로,
  FE 발급 정책 결정은 **불필요**로 바뀐다. ADR-0010이 미뤄둔 "대화 시작 시점" 정책을
  계속 비워두는 대신, 합리적 기본(세션 단위)을 정하고 덮어쓸 길을 남기는 쪽을 택했다.
- **TTL이 자연스러운 대화 리셋을 이미 제공한다.** 30분(기본) 무응답이면 키가 만료돼
  같은 세션이라도 새 대화로 시작한다. 세션 단위 기본값의 "대화가 너무 길게 이어짐" 우려는
  TTL이 완화한다.
- **provider 체이닝은 실측 확인됨.** GMS Responses API의 `previous_response_id`가 실제로
  동작함을 2-turn 프로브로 확인했다(직전 질문 정확히 회상). ADR-0010의 미실측 전제가
  해소됐다.

## 구현

- `app/rag/service.py` `_conversation_memory_key`: `userId`만 검사, `conversationId or
  "session"`.
- `ai/ai-api/CONTRACT.md` §7-1 활성 조건 갱신.
- 테스트: userId 단독 활성(키에 `session`), conversationId 덮어쓰기, userId 부재 시
  완전 비활성 가드 — `tests/test_rag_streaming.py`.

## 남은 것 (이 ADR 밖)

- **Spring**: wire에 `userId`(로그인 사용자 식별자) 추가 — 공유 계약 변경이므로 3-오너
  합의 + 루트 `docs/CONTRACT.md` 갱신 절차를 따른다.
- **활성화 전 필수 보강**: provider에서 만료된 `previous_response_id`에 대한 404/400을
  현재 `MODEL_CONFIGURATION_ERROR`(비재시도, 답변 실패)로 매핑한다. 체이닝만 버리고
  재호출하는 fail-open 분기가 필요하다(ADR-0010 §세부 동작이 이미 지적). 별도 작업.
- v2(Replay)는 ADR-0037에 따라 계속 범위 밖.
