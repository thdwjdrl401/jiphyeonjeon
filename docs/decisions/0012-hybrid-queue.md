# ADR-0012: 하이브리드 큐 — RabbitMQ(배치) + Redis Streams(fast path)

> 📍 하네스 개요: [../harness/README.md](../harness/README.md) · 아키텍처: [../ARCHITECTURE.md](../ARCHITECTURE.md)

- **상태**: 채택
- **일자**: 2026-07-14
- **관련**: [0008](0008-ai-bus-redis-streams-session-clock.md), [0011](0011-ai-three-services.md), [0013](0013-unified-streaming-stt.md)

## 맥락
비동기 작업이 성격이 다르다: ① 업로드 후 **수분짜리 배치**(STT·파싱·embedding·후보·트랜스코드) — 유실=재업로드, retry/DLQ 필요. ② **실시간 스트림**(STT 조각·라이브 자막) — 저지연, partial 유실 허용.

## 결정
**하이브리드**로 분리한다:
- **RabbitMQ** = durable 배치 잡(ingestion·트랜스코드). ack/재시도/**DLQ**/우선순위.
- **Redis Streams** = STT 조각·라이브 자막 **fast path**. consumer group으로 소비.
- **Redis(그 외)** = cache/session/rate-limit. **durable 잡 큐로는 쓰지 않음**.

## 근거
- 긴 배치는 유실 방지가 중요 → 잡 전용 도구(RabbitMQ)가 정석.
- 실시간 자막은 저지연·스트림 → Redis Streams가 자연스럽고, 이미 있는 Redis 재활용.
- 캐시 부하가 잡 신뢰성을 흔들지 않게 역할 분리.

## 대안
| 대안 | 장점 | 단점 |
|---|---|---|
| **하이브리드 (선택)** | 각자 최적 도구 | 인프라 2종 |
| 전부 Redis Streams | 서비스 절약 | 배치 DLQ/내구성 직접 구현·상대적 약 |
| 전부 RabbitMQ | 잡 시맨틱 일관 | 실시간 자막에 지연 오버헤드 |

## 영향·후속
- Spring은 **outbox**로 잡 발행 신뢰성 확보, RabbitMQ 컨슈머(ai-worker/FFmpeg). idempotency key·DLQ 운영 지표.
- ADR-0008은 "Redis Streams = fast path 전용"으로 보완됨.
