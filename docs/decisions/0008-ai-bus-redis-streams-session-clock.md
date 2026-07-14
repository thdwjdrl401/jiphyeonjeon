# ADR-0008: AI 버스 = Redis Streams, 자막 싱크 = 세션 상대 ms

> 📍 하네스 개요: [../harness/README.md](../harness/README.md) · 아키텍처: [../architecture.md](../architecture.md)

- **상태**: 채택 (보완 2026-07-14: **하이브리드 큐**로 조정)
- **일자**: 2026-07-14
- **관련**: [0004](0004-media-livekit-selfhost.md), [0006](0006-backend-spring-plus-python-ai.md), [0012](0012-hybrid-queue.md), [0013](0013-unified-streaming-stt.md)

> **보완**: Redis Streams는 **STT·라이브 자막 fast path 전용**이다. embedding·PPTX파싱·후보생성·트랜스코드 같은 **무거운 durable 배치는 RabbitMQ**로 분리 → [0012](0012-hybrid-queue.md). STT는 VOD·라이브 공유 스트리밍(VAD) → [0013](0013-unified-streaming-stt.md). 세션 상대 ms 좌표계는 유지.

## 맥락
Python AI가 자막·enrichment를 Spring에 **지속적으로** 전달해야 하고, 자막·채팅·영상·되감기의 **시간 정렬** 기준이 필요하다.

## 결정
1. **라이브 enrichment는 Redis Streams 푸시**: 자막(partial/final/revised) + 용어감지 + RAG 근거 + 구조 요약을 Python→Spring 스트림으로. **Q&A는 별도 동기 요청/응답**(스트림 아님).
2. **모든 시간을 세션 상대 ms로 통일**(t0 = 강사 오디오 발행 시작).

## 근거
- Redis는 LiveKit 때문에 **이미 있음** → 재활용(추가 인프라 0).
- Streams는 내구성·재처리·리플레이 지원(자막 유실 방지).
- 단일 좌표계라 되감기·리플레이 정렬이 공짜. 라이브 STT 지연은 **보강 지평선**으로 흡수.

## 대안
| 대안 | 장점 | 단점 |
|---|---|---|
| **Redis Streams + 세션ms (선택)** | 인프라 재활용·내구·단일좌표 | Streams 소비 로직 필요 |
| gRPC 스트림 | 타입 안전 | 오버킬·추가 인프라 |
| WebSocket 브릿지 | 단순 | 내구성·재처리 약함 |
| 시간 = 벽시계 | 단순 | 되감기·리플레이 정렬 깨짐 |

## 영향·후속
- Spring이 Redis Streams **consumer**(consumer group). `transcript_segment`에 `start_ms`/`end_ms`·`revision`.
- 세션시계 변환 기준점(LiveKit 트랙 타임스탬프 → 세션 t)은 구현 단계 TODO.
- Q&A는 동기 경로: `Spring→Python→LLM→Spring`, 요청자에게만 라우팅.
