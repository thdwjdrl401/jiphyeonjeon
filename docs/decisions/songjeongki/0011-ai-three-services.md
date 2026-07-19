# ADR-0011: AI 플레인 = 3-서비스 (ai-api + ai-worker + realtime-agent)

> 📍 하네스 개요: [../harness/README.md](../../harness/README.md) · 아키텍처: [../ARCHITECTURE.md](../../ARCHITECTURE.md)

- **상태**: 채택
- **일자**: 2026-07-14
- **관련**: [0006](0006-backend-spring-plus-python-ai.md), [0012](0012-hybrid-queue.md), [0013](0013-unified-streaming-stt.md)

## 맥락
AI 플레인은 Python 확정([0006](0006-backend-spring-plus-python-ai.md)). 그런데 AI 안에 **런타임 모델이 다른** 작업이 섞임: 실시간 SSE 질의 응답, 무거운 배치 잡, 상주 라이브 오디오 처리.

## 결정
Python AI를 **3개 서비스**로 나눈다:
- **ai-api (FastAPI)** — 실시간: RAG 질문 SSE·용어 설명. Spring이 internal 호출, SSE는 Spring이 중계.
- **ai-worker** — 배치: PPTX 파싱·chunk·embedding·후보생성. **RabbitMQ 컨슈머**.
- **realtime-agent** — 라이브: 강사 오디오 구독→스트리밍 STT→Redis Streams (LiveKit Agent).
- **(공유) STT 라이브러리** — VOD용(업로드→워커)과 라이브용(agent)이 STT 로직 공유([0013](0013-unified-streaming-stt.md)).

## 근거
- SSE 서버·큐 컨슈머·상주 프로세스는 **런타임 특성이 달라** 분리해야 독립 배포·확장·장애 격리.
- 데모에선 ai-worker를 **단일 풀로 시작**, 나중에 stt/rag/analysis 큐별 분리.

## 대안
| 대안 | 장점 | 단점 |
|---|---|---|
| **3-서비스 (선택)** | 런타임별 최적·독립 확장 | 서비스 수↑ |
| 단일 Python 서비스 | 단순 | SSE·배치·상주 혼재로 확장·격리 어려움 |

## 영향·후속
- 배포 단위: ai-api / ai-worker / realtime-agent. RabbitMQ·Redis Streams 연동([0012](0012-hybrid-queue.md)).
- ai-api는 외부 비노출(Spring 경유만).
