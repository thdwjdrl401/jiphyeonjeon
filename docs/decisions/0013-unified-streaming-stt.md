# ADR-0013: 통합 스트리밍 STT (VAD, VOD·라이브 공유)

> 📍 하네스 개요: [../harness/README.md](../harness/README.md) · 아키텍처: [../architecture.md](../architecture.md)

- **상태**: 채택
- **일자**: 2026-07-14
- **관련**: [0008](0008-ai-bus-redis-streams-session-clock.md), [0011](0011-ai-three-services.md), [0012](0012-hybrid-queue.md)

## 맥락
STT가 VOD(녹화)와 라이브 양쪽에 필요. VOD는 배치, 라이브는 실시간이라 따로 만들 수도 있으나, "지평선(자막 지연)을 라이브에 가깝게" 하려면 STT를 짧은 조각으로 흘리는 게 유리.

## 결정
**STT를 짧은 조각의 스트리밍**으로 통일한다. VOD용(업로드→ai-worker)과 라이브용(realtime-agent)이 **같은 STT 로직**을 공유하고, 결과는 **Redis Streams**로 흘린다.

## 근거
- 한 파이프라인으로 VOD·라이브 모두 커버(중복 제거).
- 라이브: partial 거의 실시간, 교정+RAG는 지평선만큼만 지연.
- VOD: 오디오 전량 존재 → 사전 처리로 지평선 없음(전 구간 즉시). 짧은 조각의 이득은 강사 처리 진행 점진 표시.

## 주의 (핵심 리스크: 한국어 전문용어 recall)
- **고정 시간이 아니라 VAD(무음 감지)로 자르고 overlap** → 용어가 중간에 잘리는 것 방지.
- 과하게 짧으면 교정/RAG 문맥 부족으로 품질↓ → "짧게"에는 하한이 있다.
- STT 공급자 bake-off(한국어 강의 샘플)로 recall·지연·비용 검증(고도화 단계).

## 대안
| 대안 | 장점 | 단점 |
|---|---|---|
| **통합 스트리밍 (선택)** | VOD·라이브 1파이프라인, 지평선↓ | VAD·overlap 구현 필요 |
| VOD 배치 + 라이브 스트리밍 별도 | 각각 단순 | 코드 중복, VOD 진행 표시 늦음 |

## 영향·후속
- 공유 STT 라이브러리를 ai-worker·realtime-agent가 사용. 출력은 `ai.transcript_segment`(원본) + Redis Streams.
- 세션 상대 ms 좌표 유지([0008](0008-ai-bus-redis-streams-session-clock.md)).
