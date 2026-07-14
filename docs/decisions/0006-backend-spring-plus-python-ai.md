# ADR-0006: 컨트롤 플레인 = Spring Boot(Java), AI 플레인 = Python 분리

> 📍 하네스 개요: [../harness/README.md](../harness/README.md) · 아키텍처: [../ARCHITECTURE.md](../ARCHITECTURE.md)

- **상태**: 채택
- **일자**: 2026-07-14
- **관련**: [0004](0004-media-livekit-selfhost.md), [0008](0008-ai-bus-redis-streams-session-clock.md)

## 맥락
FE는 TypeScript(React), AI는 Python이 사실상 강제된다(LiveKit Agents가 Python 1급). 남은 결정은 **컨트롤/데이터 플레인(백엔드)** 의 스택이다.

## 결정
컨트롤/데이터 플레인 = **Spring Boot(Java)**, AI 플레인(STT·RAG·Agent) = **Python 별도 서비스**로 분리한다.

## 근거
- 팀의 Spring 친숙도·성숙도 최고, Security/JPA 강력.
- AI는 Python 생태계(LiveKit Agents·STT·RAG) 필수.

## 대안
| 대안 | 장점 | 단점 |
|---|---|---|
| **Spring + Python AI (선택)** | 팀 친숙, Security/JPA | 3언어(Java+Py+TS), 브릿지 필요 |
| Python 단일(FastAPI+Agents) | 브릿지 소멸, 2언어 | 팀 친숙도 낮음 |
| NestJS + Python AI | FE/BE 언어 통일(TS) | 팀 Nest 경험 없음 |

## 영향·후속
- **Python↔Spring 브릿지가 확정 인터페이스** → 대충 넘기지 말고 계약 설계([0008](0008-ai-bus-redis-streams-session-clock.md), [CONTRACT.md](../CONTRACT.md)).
- 3언어 시스템 → 통합 지점(브릿지)이 최대 리스크이므로 계약·테스트로 관리.
