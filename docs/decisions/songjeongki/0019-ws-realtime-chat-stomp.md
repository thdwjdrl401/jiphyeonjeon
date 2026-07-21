# ADR-0019: 실시간 채팅 = STOMP over WebSocket + 커밋 후 이벤트 브로드캐스트

> 📍 하네스 개요: [../harness/README.md](../../harness/README.md) · 아키텍처: [../ARCHITECTURE.md](../../ARCHITECTURE.md) · 계약: [../CONTRACT.md](../../CONTRACT.md)

- **상태**: 채택
- **일자**: 2026-07-19
- **관련**: [0007](0007-domain-live-session.md), [0008](0008-ai-bus-redis-streams-session-clock.md), [0014](0014-auth-redis-session-cookie.md)

## 맥락
- CONTRACT §3-4·[frontend/api/LIVE.md](../../frontend/api/LIVE.md) §8이 FE↔Spring WebSocket 채팅 채널을 규정: 엔드포인트 `/api/ws`(쿠키 인증), 채널 `/topic/live-sessions/{sessionId}/chat`, 이벤트 `chat.message.created`, 봉투 `{eventId, type, sessionId, occurredAt, payload}`.
- 채팅 **저장·복구(REST)** 골격은 이미 있음(CHAT-01, `mine`·가명·멱등). 남은 절반이 **실시간 전달(WS)**.
- 인증은 쿠키 세션(ADR-0014). 브라우저 WS는 Authorization 헤더를 못 붙이지만 **쿠키는 핸드셰이크에 자동 전송**된다.

## 결정
1. **STOMP over native WebSocket**, 엔드포인트 `/api/ws`. 구독 `/topic/**`(단일 인스턴스 SimpleBroker), 클라 전송 `/app/**`.
2. **인증 = 핸드셰이크의 쿠키 세션.** 핸드셰이크가 시큐리티 필터를 타므로 세션의 인증 주체(userId)가 그대로 STOMP `Principal`이 된다 — **별도 WS 토큰·STOMP CSRF 없음**. 미인증 핸드셰이크는 401.
3. **CSWSH 방어 = 오리진 화이트리스트**(`liveclass.ws.allowed-origin-patterns`). WS는 CSRF 토큰이 아니라 **오리진 검증**이 정석. 같은 오리진 배포(nginx)라 운영은 도메인 하나, dev는 `localhost:*`.
4. **브로드캐스트는 "저장됨" 도메인 이벤트에 반응**(`@TransactionalEventListener(AFTER_COMMIT)`). REST POST든 WS SEND든 **실제 저장이 일어난 경우에만**(멱등 재전송 제외) 커밋 후 발행 → 롤백된 메시지는 새어나가지 않고, 두 전송 경로가 한 브로드캐스트 로직을 공유.
5. **payload에서 `userId` 제거**(open-questions §8 확정). 브로드캐스트는 뷰어별이 될 수 없으므로 `mine`을 싣지 않는다 — 라이브 중 "내 메시지"는 FE가 자기 `clientMessageId` 에코로, 콜드 복구는 REST GET의 `mine`으로 판별. 실명·userId는 어디에도 없음(가명만).

## 근거
- 쿠키 핸드셰이크 인증은 ADR-0014의 "유저-인증 경계 = Spring 1곳"과 정합 — WS만을 위한 별도 토큰 체계를 만들 이유가 없다.
- "저장 이벤트 → 브로드캐스트" 분리로 **전송 경로(REST/WS)와 실시간 전달이 디커플**된다. WS SEND가 주 경로, REST POST는 fallback(CHAT-01)인데 둘 다 저장만 하면 자동으로 실시간에 실린다.
- AFTER_COMMIT이라 **"저장 안 된 걸 실시간으로 보여주는"** 불일치가 구조적으로 불가능.
- `userId`를 안 실어도 우측 정렬이 되므로(에코+`mine`), 익명성을 지키면서 기능 손실이 없다.

## 대안
| 대안 | 장점 | 단점 |
|---|---|---|
| **STOMP + 커밋 후 이벤트 (선택)** | 표준·경로 디커플·롤백 안전·익명성 유지 | 단일 인스턴스 SimpleBroker(확장 시 교체) |
| Raw WebSocket(직접 핸들러) | 의존성 최소 | pub/sub·구독 관리·프레이밍을 직접 구현 |
| @SendTo로 핸들러에서 즉시 반환 | 코드 짧음 | 커밋 전 발행 위험·REST 경로는 별도 브로드캐스트 필요(중복) |
| Redis Streams로 채팅도 흘림 | 자막과 통일 | ADR-0008 스트림은 **AI 자막 버스** 전용 — 채팅은 core 직접 쓰기(ARCHITECTURE §도메인), 과설계 |

## 영향·후속
- **확장**: 다중 인스턴스가 되면 SimpleBroker 브로드캐스트가 인스턴스 경계를 못 넘는다 → 외부 브로커 릴레이(Redis/RabbitMQ STOMP)로 교체. 계약(destination·봉투)은 불변.
- **구독 인가(구현됨, 2026-07-21)**: 핸드셰이크만 통과하면 아무나 `/topic/live-sessions/{id}/chat`을 구독해 실시간 채팅을 받을 수 있던 구멍을, `ChannelInterceptor`(`ChatTopicSubscriptionInterceptor`)로 SUBSCRIBE를 REST 조회와 동일 게이트(소유 강사·활성 수강생, `LiveAccessGuard.requireCanAccess`)로 검증해 닫았다.
  - **핵심 결정 — 와일드카드 구독 차단**: SimpleBroker는 구독 destination을 AntPathMatcher **패턴으로 매칭**한다. 즉 `/topic/**`·`/topic/live-sessions/*/chat` 같은 와일드카드 구독이 특정 세션 브로드캐스트를 수신할 수 있어, 구체 토픽만 검사하면 우회된다. 그래서 `/topic`의 **구체적 채팅 토픽(`/topic/live-sessions/{uuid}/chat`)이 아닌 구독은 전부 거부**한다 — 이 앱의 유일한 브로커 토픽이 채팅이라 안전하고, 유효 UUID엔 패턴 메타문자가 없어 허용된 구독은 자기 세션만 매칭한다. (`/topic` 아닌 destination은 SimpleBroker의 prefix 검사가 애초에 등록을 막는다 — 2겹 방어.)
  - **모듈 경계**: 인터셉터 등록은 `common→live` 역의존을 피해 live 모듈의 별도 `WebSocketMessageBrokerConfigurer`(`ChatWsSecurityConfig`)로 분리한다(브로커 설정은 common의 `WebSocketConfig` 유지, Spring이 모든 configurer를 수집·적용).
  - 전송(SEND)은 이미 컨트롤러(`ChatWsController`)에서 게이팅되며, REST 조회·토큰 발급 게이트와 함께 라이브 접근제어를 완성한다. 후속: SUBSCRIBE 레이트리밋.
- **세션 만료 전파**: 핸드셰이크 시점 인증만 강제한다. HTTP 세션이 만료돼도 열린 WS는 즉시 끊기지 않음 — 강제 로그아웃/강퇴 즉시성이 필요하면 Spring Session WS 연동(만료 시 disconnect)을 추가.
- **자막·presence·state 채널**(LIVE.md §8)은 이 ADR 범위 밖(CP2 STT 등에서 같은 봉투·엔드포인트 재사용).
- **미구현 계약 항목**: WS `mine` 대체안은 FE 회신 대기(open-questions §8).
