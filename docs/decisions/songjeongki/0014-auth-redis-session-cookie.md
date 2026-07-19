# ADR-0014: 인증 = HttpOnly 쿠키 + Redis 세션 (엣지), 내부 S2S·미디어 = JWT

> 📍 하네스 개요: [../harness/README.md](../../harness/README.md) · 아키텍처: [../ARCHITECTURE.md](../../ARCHITECTURE.md) · 계약: [../CONTRACT.md](../../CONTRACT.md)

- **상태**: 채택
- **일자**: 2026-07-15
- **관련**: [0004](0004-media-livekit-selfhost.md), [0006](0006-backend-spring-plus-python-ai.md), [0008](0008-ai-bus-redis-streams-session-clock.md), [0011](0011-ai-three-services.md)

## 맥락
- React SPA ↔ Spring **분리 오리진**(dev 8083 / 8080). 인증 크리덴셜 전송 방식이 CORS·CSRF·XSS 노출을 좌우.
- **SSE(RAG 스트림)·WebSocket(자막·채팅)** 이 코어인데, 브라우저 `EventSource`·`WebSocket`은 **Authorization 헤더를 못 붙인다**.
- 원칙 #1([ARCHITECTURE](../../ARCHITECTURE.md)): **React는 Spring으로만**, Python AI는 브라우저 비노출 → **유저-인증 경계는 Spring 1곳**뿐(ai-api·ai-worker·realtime-agent는 유저 토큰을 안 봄).
- 클래스 플랫폼 → **즉시 강퇴·강제 로그아웃**(세션 무효화) 니즈.
- **Redis 이미 존재**([0008](0008-ai-bus-redis-streams-session-clock.md)·[0012](0012-hybrid-queue.md)): cache/session/STT 스트림.

## 결정
**전송(쿠키 vs 헤더)** 과 **토큰 내용(opaque vs JWT)** 은 독립 축이다. 계층별로 나눈다:

1. **엣지 (브라우저 ↔ Spring)** = **opaque 세션ID를 HttpOnly·Secure·`SameSite=Lax` 쿠키**로 전송, **세션 본체는 Redis**(Spring Session Redis). 상태변경 요청엔 **CSRF 토큰**. dev=Vite 프록시 / prod=nginx 역프록시로 **same-origin** 구성.
2. **내부 S2S (Spring → Python)** = **단명 서명 JWT**(검증된 scope·비용 claim). 유저 세션과 **트러스트 도메인 분리**.
3. **미디어 (Spring → LiveKit)** = **LiveKit JWT**(프로토콜 강제, 별개 토큰 — [0004](0004-media-livekit-selfhost.md)).
4. **인증 필터를 seam으로** 둔다 → 토큰 내용(opaque↔JWT) 교체가 서버 필터 한 곳으로 국소화(재생 인증 seam과 동일 패턴 — [0010](0010-self-host-vod.md)).

## 근거
- **SSE·브라우저 WS가 헤더를 못 붙임** → 쿠키 자동전송이 스트리밍 인증에 유일하게 깔끔(헤더 방식은 토큰을 쿼리스트링에 실어 액세스로그 유출).
- **HttpOnly = XSS로 크리덴셜 탈취 불가**(SPA의 주 위협). localStorage 토큰의 근본 약점 회피.
- 유저-인증 경계가 **Spring 1곳**이라 "여러 서비스가 무상태로 각자 검증"하는 JWT 이점이 발동할 지점이 없다 → 쿠키+Redis가 더 단순.
- Redis 이미 있음 → **세션 저장·즉시 무효화(강퇴/로그아웃) 공짜**.
- Redis 세션은 앱 인스턴스를 **무상태로 유지**(sticky 불필요, 수평 확장) → "세션=확장 불가"는 JVM in-memory 세션 얘기일 뿐, 우리 구성과 무관.

## 대안
| 대안 | 장점 | 단점 |
|---|---|---|
| **쿠키 + Redis 세션 (선택)** | SSE/WS 자동전송·XSS 안전·즉시 무효화·인프라 재활용 | 요청당 Redis 조회 1회·인증이 Redis 가용성에 종속 |
| JWT(localStorage) + Bearer | 무상태·SSE는 헤더 | XSS 탈취·**SSE/WS 헤더 불가**(쿼리 꼼수)·즉시 취소 어려움 |
| JWT-in-HttpOnly 쿠키 | 무상태 + 쿠키 전송 | 즉시 취소 불가(TTL 종속)·리프레시 회전 복잡 |

> **전환 안전판**: 전송을 쿠키로 고정했으므로, 나중 확장이 필요하면 **opaque → JWT-in-쿠키**로 바꿔도 **FE·계약 무변경, 서버 인증 필터만 교체**. 지금 과최적화하지 않는다.

## 영향·후속
- **CONTRACT §2 인증**: 쿠키 세션 명시. **FE = axios `withCredentials: true`, `Authorization: Bearer`·localStorage 토큰 미사용**([frontend/AGENTS.md](../../../frontend/AGENTS.md)).
- **CP0**에서 구현: 세션 TTL·슬라이딩 갱신, CSRF 토큰 방식(더블 서브밋 vs 헤더), 쿠키 속성(`Secure`·`SameSite`)·프록시 same-origin 셋업.
- **즉시 강퇴**는 Redis 세션 삭제로 처리. 필요 시 세션 인덱스(userId→sessionIds).
- 내부 S2S JWT 서명키·claim 스키마, LiveKit 토큰 grant 세부는 [CONTRACT §3](../../CONTRACT.md) / CP1에서 확정.
