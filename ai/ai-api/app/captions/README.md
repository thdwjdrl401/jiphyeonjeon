# `ai-api/app/captions`

realtime-agent가 application Redis에 쓰는 AI-side caption v1 entry를 검증하고 최근 질문 문맥으로 접는다.

## 현재 wire shape

- delta: `caption.delta` + `lessonId/sessionId/sttSessionId/sequence/streamElapsedMs/text`
- terminal: `caption.stream.completed` + 같은 scope와 `lastSequence/reason=ROOM_DELETED`
- 정수는 최대 18자리 문자열이며 field는 camelCase다.

## attempt 규칙

sequence와 `streamElapsedMs`는 session 전체가 아니라 `(sessionId, sttSessionId)` attempt 안에서만 증가한다.
새 attempt가 오면 최신 context로 교체하고 sequence 1을 허용한다. 완료 전에 교체되면 incomplete로 표시하며,
retired attempt의 늦은 entry는 현재 문맥을 덮지 못한다. bounded retired ID에서 빠진 아주 오래된 attempt도
`occurredAt`이 현재 attempt 시작보다 늦지 않으면 stale로 거부한다.

한 session은 최초 `lessonId`에 고정된다. event ID 재사용, sequence 충돌, 시간 역행과 lesson 변경은 text에
반영하지 않고 관측한다. 보관량은 session 수, event 수, UTF-8 byte와 retired attempt 수로 제한한다.

`streamElapsedMs`는 producer attempt-local 시계다. Spring은 질문의 재생/session 시간을 이 좌표로 변환한
뒤 `contextTimeMs`로 보내야 하며 그 합의 전에는 공유 계약으로 확정하지 않는다.
