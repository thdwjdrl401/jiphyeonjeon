# ADR-0107: 자막 세그먼트가 벽시계를 싣는다

> 📍 하네스 개요: [../../harness/README.md](../../harness/README.md) · 아키텍처: [../../ARCHITECTURE.md](../../ARCHITECTURE.md) · 계약: [../../CONTRACT.md](../../CONTRACT.md)

- **상태**: 채택 — **생산자(realtime-agent)만 구현.** 소비자(Spring·FE)는 후속.
- **일자**: 2026-08-09
- **관련**: [0106](0106-caption-time-axis-is-wall-clock-not-audio.md)(원인 규명·되돌림), [0104](0104-anchored-caption-session-ms.md)(철회),
  [0052](0052-caption-segment-anchor-consumption.md)(앵커 영속), `ai/realtime-agent/CONTRACT.md` §3,
  [canola/0042](../canola/0042-replay-ai-caption-context-contract.md)(AI 근거 경로)
- **오너 경계**: realtime-agent(AI) 코드에 필드를 추가한다 — 기존 필드·정책은 건드리지 않는다. Spring·FE는 후속 슬라이스.

## 맥락

자막을 재생 위치에 맞추려면 **"이 말이 세션 시계로 언제 나왔는가"** 가 필요하다. 지금 파이프라인에는
그 정보가 없다.

- `streamElapsedMs`는 **받은 audio frame 길이의 합**이다(`audio_source.py`의 `_captured_nanoseconds`).
- 세그먼트 경계 `start/end_stream_elapsed_ms`는 VAD 세그먼터의 **자기 프레임 카운터**에서 온다
  (`segmentation.py`의 `_elapsed_ms`). 별개 카운터지만 **같은 성질**이다 — 둘 다 오디오 누적이다.
- `occurredAt`은 벽시계지만 **발행 시각**이라 발화보다 STT 지연만큼 늦다.

ADR-0104는 `앵커 + streamElapsedMs`로 정확한 세션-ms를 얻으려 했고 실패했다(ADR-0106). 무음이 빠진
축에 앵커를 더하면 빠진 만큼 앞당겨진다.

**실행으로 확인했다.** 1초 발화 → 20초간 프레임 없음 → 1초 발화를 실제 `VadSegmenter`에 먹였다.

```
벽시계 경과   22,000 ms      audio 누적   2,000 ms      차이 20,000 ms

              진실        종전 공식        새 startedAt
발화 1         0 ms         0 ms  ✓          20 ms  ✓
발화 2    21,000 ms     1,000 ms  ✗(−20초)  21,020 ms  ✓
```

## 결정

### 1. `segment.final`에 `startedAt`·`endedAt`을 **덧붙인다**

그 발화가 실제로 시작·종료한 UTC 벽시계다. 소비자는 `startedAt − clockOriginAt`만 하면 세션-ms를 얻는다.
앵커 산술도, `CAPTION_STT_LAG_MS` 같은 보정 상수도 필요 없어진다.

### 2. 기존 필드의 의미를 바꾸지 않는다

`streamElapsedMs`를 벽시계로 바꾸는 안(A)을 검토했고 **폐기했다.** AI팀 계약이 무음 제외를 의도로
명시하고 있고(`CONTRACT.md` §3), VAD 정책과 문장 안분(`_apportion`)이 그 축 위에 서 있다. 한 줄로
싸게 끝나 보였지만 남의 모듈의 전제를 덮어쓰는 일이다.

### 3. 전부 선택 필드다 — 없으면 종전과 동일

audio source가 도착 시각을 stamp하지 않으면 키 자체가 빠진다. Redis payload에 **빈 문자열을 넣지
않는다** — 소비자가 "0"과 구분하지 못한다. 스키마에도 `required`가 아니라 `properties`로만 넣었다.

이 성질이 **되돌리기를 싸게 만든다.** 소비자가 아직 없으므로 이 슬라이스는 관측 가능한 동작을 전혀
바꾸지 않는다.

### 4. 벽시계 대응은 청크마다 기록한다

`VadSegmenter`가 `(오디오 시계, 벽시계)` 짝을 청크마다 쌓는다. 러닝 오프셋 하나로는 안 된다 — 소리가
끊긴 순간 그 공백은 벽시계에만 속하므로, **공백 이전의 경계는 그때 유효했던 표식으로 되짚어야** 한다.
표식은 이 정책이 만들 수 있는 가장 긴 세그먼트 + pre-roll 만큼만 보관한다(그보다 오래된 것은 참조될 수 없다).

### 5. 한 세그먼트가 여러 문장이면 같은 비율로 나눈다

`_apportion`이 오디오 축에서 문장을 나누는 비율을 벽시계에도 그대로 적용한다. 세그먼트 안에서는 소리가
끊기지 않으므로(끊겼다면 거기서 닫혔다) 비율이 성립한다.

## 고려한 대안

**`streamElapsedMs`를 벽시계로 변경(A).** 위 §2. 계약 위반이고 VAD 정책에 영향이 간다.

**Spring이 공백을 추정해 보정.** `(occurredAt − audioStartedAt) − streamElapsedMs`로 "공백 + 지연"은
구할 수 있지만 **둘을 분리할 수 없다.** 지연만 빼야 하는데 공백까지 빼면 다시 어긋난다.

**delta에도 벽시계를 싣기.** 델타는 진행 중 조각이라 곧 세그먼트가 덮는다. 표시 정밀도에 기여하는
것은 확정 세그먼트이므로 범위를 좁혔다. 필요해지면 같은 방식으로 확장한다.

## 결과

- 자막을 세션 시계에 **정확히** 놓을 수 있는 정보가 처음으로 파이프라인에 생긴다.
- 지금은 **아무도 소비하지 않는다** — 관측 가능한 변화가 없다.
- 후속으로 Spring이 `startedAt − clockOriginAt`을 계산해 내려주면, FE의 근사 축과
  `CAPTION_STT_LAG_MS`가 함께 사라진다. **AI 근거 경로(`ReplayAiContextService`)의 최대 21초 오차도
  같이 풀린다.**

## 검증

전부 실제 코드를 실행해 확인했다(추론 아님).

- `tests/test_caption_wall_clock.py`(신규) — 오디오 축이 무음을 잃는다는 전제 자체를 고정하고,
  공백 뒤 세그먼트의 `startedAt`이 실제 시각을 가리키는지, 시각을 안 주면 지어내지 않는지 확인한다.
- 발행 payload를 만들어 **JSON 스키마로 검증** — 벽시계 있음/없음 양쪽 통과.
- realtime-agent 기존 테스트 174개 통과(livekit·numpy 등 미설치 모듈 제외).
- Spring `CaptionEventParser`는 필요한 키만 읽어 새 필드를 무시한다 — 소비자 영향 없음을 코드로 확인.
