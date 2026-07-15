# ADR-0004: 미디어 서버 = LiveKit self-host (Kurento 대체)

> 📍 하네스 개요: [../harness/README.md](../harness/README.md) · 아키텍처: [../ARCHITECTURE.md](../ARCHITECTURE.md)

- **상태**: 채택 (2026-07-14 개정: 완전 라이브 → **LiveKit이 유일 미디어**, Egress 코어)
- **일자**: 2026-07-14
- **관련**: [0003](0003-greenfield-redesign.md), [0006](0006-backend-spring-plus-python-ai.md), [0008](0008-ai-bus-redis-streams-session-clock.md), [0010](0010-self-host-vod.md)

> **보완(개정)**: 제품이 **완전 라이브 지향**으로 확정되어 LiveKit이 **유일 미디어**다. 라이브는 SFU, **다시보기 VOD는 Egress 녹화**(→HLS→MinIO, nginx 서빙 — [0010](0010-self-host-vod.md)). **영상 업로드·FFmpeg 없음.** Egress는 **코어**(추후 아님). 라이브는 서비스의 토대([0003](0003-greenfield-redesign.md)).

## 맥락
그룹 화상 + **서버측 미디어 접근**(AI 자막을 위해 오디오 구독)이 필요하다. 공식 스켈레톤은 Kurento를 쓰지만 시그널링을 직접 구현해야 하고 Agents/Egress 통합이 약하다.

## 결정
미디어 서버를 **LiveKit self-host(SFU)** 로 한다. **Egress**(HLS·녹화) + **Agents**(오디오 구독)를 함께 쓰고, Docker로 자체 호스팅한다.

## 근거
- **Agents**로 서버측 오디오 구독(STT용)이 1급 지원.
- **Egress**로 HLS·녹화(되감기·VOD)를 바로 얻음.
- React 클라이언트 SDK 성숙, self-host로 비용·제어 확보.
- Kurento 대비 시그널링 부담이 훨씬 적음.

## 대안
| 대안 | 장점 | 단점 |
|---|---|---|
| **LiveKit self-host (선택)** | Agents·Egress 통합, 제어 | Redis·Egress 등 셋업 부담 |
| Kurento | 스켈레톤 제공 | 시그널링 직접·최고난도, Agents 없음 |
| mediasoup/Janus | 경량 SFU | Agents/Egress 통합 약함 |
| LiveKit Cloud | 셋업 쉬움 | 비용·외부 의존 |

## 영향·후속
- 백엔드 시그널링 역할이 **토큰 발급·Egress 제어**로 축소.
- **Redis 필요**(LiveKit 조정 요구) → [0008](0008-ai-bus-redis-streams-session-clock.md)에서 재활용.
- self-host 구성(Docker Compose)은 구현 단계 TODO.
