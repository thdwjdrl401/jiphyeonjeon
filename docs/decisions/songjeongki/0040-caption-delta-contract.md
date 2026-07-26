# ADR-0040: 라이브 자막 계약 — 델타 스트림 채택 + 보강 3건 (제안)

> 📍 하네스 개요: [../../harness/README.md](../../harness/README.md) · 아키텍처: [../../ARCHITECTURE.md](../../ARCHITECTURE.md) · 계약: [../../CONTRACT.md](../../CONTRACT.md)

- **상태**: 제안 (BE 작성 · **AI 조율 필요** · FE 렌더 정책 연동)
- **일자**: 2026-07-27
- **관련**: [0013](0013-unified-streaming-stt.md)(스트리밍 STT), CONTRACT §3-3·§3-4, ARCHITECTURE §9-1(지평선)·§9-3(자막 유실), canola 0012(VAD·provider)·0014(후보 계약) — canola 0009~0014는 MR !120·!121에 있음(master 합류 전이라 링크는 병합 후 연결)
- **오너 경계**: BE(송정기) — dispatch·소비·영속·WS 중계 / AI(유채은·박진우) — agent 발행 계약 / FE(윤광혁·서민경) — 자막 렌더

## 맥락

라이브 자막 계약이 두 벌 존재한다.

- **CONTRACT §3-3 (종이 계약, 미구현)**: `caption.partial|final|revised { segmentId, startMs, endMs, text, revision }`, 시간은 세션 상대 ms. 설계 시점에 표현(렌더) 계층 관점으로 쓴 것으로, BE·FE 어느 쪽에도 구현이 없다.
- **realtime-agent 후보 계약 (MR !121, 구현됨)**: `caption.delta { eventId, sessionId, lessonId, sttSessionId, sequence, streamElapsedMs, text, occurredAt }` + 종료 시 `caption.stream.completed`. Redis Stream 전역 키 `ai:captions:live`에 XADD. AI 팀이 "후보 계약, §3-3 미채택"으로 명시 격리했다(`ai/realtime-agent/contracts/README.md`).

차이의 원인은 층위다. 실시간 STT 엔진의 원출력은 증분 델타이지 확정된 문장이 아니고, agent는 라이브 세션 생성 시각을 모르므로 세션 상대 ms를 만들 수 없다(자기 첫 오디오 프레임 기준 `streamElapsedMs`만 가능). §3-3을 강제하면 agent가 세그먼트 조립과 세션 시계를 떠안는다.

## 결정(제안)

**§3-3을 델타 전송 모델로 개정한다.** agent의 후보 계약을 기반으로 채택하되, BE·FE가 소비 가능해지기 위한 보강 3건을 계약에 포함한다. 가공 책임 배치: **agent는 엔진 원출력 전달까지, 확정 판정은 VAD 세그먼트 경계에서 agent가, 시간축 변환·영속·FE 중계는 BE가** 맡는다.

### 보강 1 — 세그먼트 확정 이벤트 (필수)

델타 스트림에는 "이 문장은 끝났다"는 신호가 없다(`stream.completed`는 세션 종료 1회뿐). 이대로는 FE가 진행중/확정 렌더를 구분할 수 없어 지평선 정책(§9-1)을 구현할 수 없다. agent의 VAD segmenter(canola 0012)가 세그먼트를 닫을 때 다음 이벤트를 추가 발행한다:

```json
{
  "type": "caption.segment.final",
  "eventId": "...", "sessionId": "...", "lessonId": "...",
  "sttSessionId": "...",
  "segmentSeq": 7,
  "startElapsedMs": 41000, "endElapsedMs": 44200,
  "text": "확정된 문장 전체",
  "occurredAt": "...", "contractVersion": "1"
}
```

- FE 렌더 정책이 기계적으로 도출된다: **델타 = 진행중(회색) 표시, segment.final = 확정 교체**.
- 지평선 N은 별도 상수가 아니라 "VAD 세그먼트 길이 + STT 지연"으로 구조에서 결정된다 → §9-1 해소.
- `revised`(교정)는 다시보기 2-pass(CP4) 산출물로 유보 — 라이브 스트림에는 없다.

### 보강 2 — 시간축 앵커 (필수)

`streamElapsedMs → 세션 상대 ms` 변환 기준. 상태 콜백(`live-agent-status`)의 `AUDIO_STARTED` 이벤트에 **`streamElapsedMs=0`에 해당하는 agent 벽시계**를 담아 attempt(`sttSessionId`)마다 전송한다. BE는 `offset = 그 벽시계 − live_session.started_at`을 attempt 단위로 저장하고, 수신 이벤트마다 `세션ms = streamElapsedMs + offset`으로 변환한다.

- 델타의 `occurredAt`으로도 변환은 가능하나, GPU 노드와 EC2의 시계 오차(NTP 스큐)가 매 이벤트의 싱크 오차가 된다. 앵커 1회 방식은 오차가 상수화된다. 양 호스트 NTP 동기화를 운영 전제로 명시한다.
- 재시도로 `sttSessionId`가 바뀌면 `sequence`·`streamElapsedMs`가 리셋되므로 앵커도 attempt마다 다시 온다는 것을 계약에 명시한다.

### 보강 3 — 스트림 키·보존 정책 (필수)

현재 전역 키 `ai:captions:live`에 `MAXLEN` 없이 XADD한다 — 소비·정리 계약이 없으면 Redis 메모리가 무한 증가한다.

- **세션별 키 `ai:captions:{sessionId}`**로 변경(agent 쪽 한 줄). 소비자·정리 단위가 세션과 일치한다.
- 세션 종료 처리 후 BE가 키를 정리(DEL 또는 TTL). 방어선으로 `XADD ... MAXLEN ~ 10000` 병기.
- 유실 정책은 §9-3 제안대로 확정: **델타는 fast-path 유실 허용(consumer group, at-least-once까지만), 확정 세그먼트만 core에 영속**. 유실 구간 정본 복구는 CP4 녹화 2-pass.

## 데이터 흐름 (개정 후 전체)

```
BE(세션 start) ── named dispatch(agent_name=liveclass-realtime-stt, metadata{sessionId,lessonId}) ──> LiveKit
agent: 오디오 구독 → PCM 정규화 → VAD → STT
  ├─ caption.delta ──────────┐
  ├─ caption.segment.final ──┤→ Redis Stream ai:captions:{sessionId}
  └─ caption.stream.completed┘
  └─ live-agent-status(AUDIO_STARTED에 시간축 앵커, HMAC(timestamp.body)) ──> BE 수신기
BE 소비자(consumer group, eventId 멱등):
  ├─ delta        → 세션ms 변환 → WS push(/topic/live-sessions/{id}/captions) → FE 진행중 렌더
  └─ segment.final → 세션ms 변환 → WS push + core 영속(caption_segment)      → FE 확정 교체
세션 종료 → stream.completed → 소비자 정리·키 정리
```

## BE 구현 목록 (합의 후 착수)

| # | 작업 | 위치 | 규모 |
|---|---|---|---|
| 1 | named agent dispatch(+metadata) — 실패 시 세션은 시작, 자막만 degrade | live | 소형 |
| 2 | Redis Stream 소비자(consumer group·eventId 멱등·시간축 변환·STOMP push) | live | 중형(본체) |
| 3 | agent 상태 콜백 수신기 — 서명 `HMAC(timestamp + "." + body)` 방식 | aiintegration | 소형 |
| 4 | `caption_segment` 영속(sessionId·lessonId·startMs·endMs·text·revision) — `GET /lessons/{id}/transcript`의 원천 | live 또는 신규 | 소형 |

3의 서명 방식은 기존 임베딩 콜백(HMAC(body), [0036](0036-material-embedding-pipeline.md))과 다르다. 타임스탬프 포함 방식이 리플레이 방어가 있어 우세하므로 **이쪽으로 수신기를 만들고, 임베딩 콜백도 후속에서 같은 방식으로 통일**을 검토한다.

## 근거

- **매몰 비용 비대칭**: §3-3은 어느 쪽에도 구현이 없고, 델타 발행은 이미 구현·테스트돼 있다(MR !121). 종이를 코드에 맞추는 쪽이 싸다.
- **지연**: 델타는 엔진 출력을 가공 없이 즉시 전달한다. 세그먼트 완성 대기가 없어 라이브 체감 지연이 최소다.
- **결정 3개가 함께 닫힌다**: 이 개정으로 §9-1(지평선 — 세그먼트 구조에서 도출), §9-3(자막 유실 — 델타 유실 허용·final 영속), §3-3(계약)이 한 번에 확정된다.

## 대안

| 대안 | 장점 | 단점 |
|---|---|---|
| **델타 채택 + 보강 3건 (제안)** | agent 변경 최소, 지연 최소, 유실·지평선 정책과 정합 | 가공 책임이 BE 소비자로 이동 |
| §3-3 유지, agent가 맞춤 | 종이 계약 불변 | agent가 세그먼트 조립·세션 시계 부담, CP2 지연, 이미 있는 구현 폐기 |
| 델타 그대로(보강 없음) 채택 | 즉시 합의 가능 | FE 확정 렌더 불가(지평선 구현 불가), 시간축 변환 불가, Redis 무한 성장 |

## 영향·후속

- **합의 후 common MR 1건**: CONTRACT §3-3 개정 + 양측 fixture·계약 테스트 동반 갱신(§6 절차). ARCHITECTURE §9-1·§9-3 해소 표기, §9-5는 GPU 노드 구조(realtime-agent·bge-runtime는 GPU 노드, ai-api·ai-worker는 EC2)로 갱신.
- 이 문서는 **열린 MR(!115·!118·!121)과의 충돌을 피하기 위해 신규 파일로만 작성**했다. CONTRACT·ARCHITECTURE 본문 수정은 위 common MR에서 한다.
- Redis 인스턴스 귀속 확정 필요: caption 스트림·session lease는 **BE와 같은 application Redis**여야 한다(canola 0014 §3의 전제 재확인).

## 조율 필요 (AI 팀)

이 ADR의 **보강 1~3**이 agent 쪽 요청 사항의 전부다: ① `caption.segment.final` 이벤트 추가(VAD 닫힘 시), ② `AUDIO_STARTED` 콜백에 시간축 앵커 필드, ③ 스트림 키 세션별 분리(+MAXLEN). 수용 여부·필드명 조정 의견을 이 MR 코멘트로 남겨 달라. 합의되면 common MR에서 계약을 확정한다.
