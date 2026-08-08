# ADR-0106: 자막 시각축은 벽시계여야 한다 — 오디오 누적으로는 안 된다

> 📍 하네스 개요: [../../harness/README.md](../../harness/README.md) · 아키텍처: [../../ARCHITECTURE.md](../../ARCHITECTURE.md) · 계약: [../../CONTRACT.md](../../CONTRACT.md)

- **상태**: 채택 (FE 되돌림 완료 / 근본 해결은 후속 계약)
- **일자**: 2026-08-09
- **관련**: [0104](0104-anchored-caption-session-ms.md)(**이 문서가 철회한다**), [0045](0045-live-caption-position-sync-approx-session-ms.md)(근사 세션-ms — 다시 정본이 된다),
  [0052](0052-caption-segment-anchor-consumption.md)(앵커 영속), [canola/0042](../canola/0042-replay-ai-caption-context-contract.md)(AI 근거 경로 — 같은 오류가 남아 있다),
  MR `!519`(도입) · 이 MR(되돌림)
- **오너 경계**: FE가 앵커 축 사용을 멈춘다. BE는 필드를 그대로 내려 준다(진단용). 근본 해결은 realtime-agent 계약 변경이라 AI 오너와 함께 연다.

## 맥락

ADR-0104는 `caption.stream.started`의 `audioStartedAt`을 앵커로 삼아 다음을 **정확한** 세션-ms라고 했다.

```
anchoredSessionMs = (audioStartedAt − clockOriginAt) + streamElapsedMs
```

배포하자 라이브 자막 싱크가 통째로 어긋났다. 자막이 말보다 한참 앞서 뜨고, 시각을 눌러 이동하면
엉뚱한 곳으로 갔다.

**전제가 틀렸다.** `streamElapsedMs`는 경과 시간이 아니라 **받은 오디오의 누적 길이**다
(`ai/realtime-agent/app/livekit/audio_source.py`).

```python
self._captured_nanoseconds += duration_ns          # 프레임의 '길이'를 더한다
stream_elapsed_ms = self._captured_nanoseconds // 1_000_000
```

무음 억제·뮤트·유실로 프레임이 오지 않은 구간은 여기 안 들어간다. 그래서 벽시계보다 **뒤처지고**,
`앵커 + streamElapsedMs`는 그 뒤처진 만큼 **앞당겨진다.**

### 실측 (운영, 최근 5세션)

`(occurredAt − audioStartedAt) − streamElapsedMs` = 오디오 공백 + STT 지연.

| 세션 | 최소 | 중앙값 | 최대 | 세션 내 편차 |
|---|---|---|---|---|
| 5747557f | 576ms | 674ms | 1,066ms | 490ms |
| 8dd4b225 | 1,719 | 1,797 | 2,215 | 496ms |
| 0ed1123c | 13,192 | 13,281 | 13,552 | 360ms |
| 9232dcaa | 19,270 | 20,389 | 20,692 | 1,422ms |
| 3c6a42de | 20,857 | 20,956 | 21,268 | 411ms |

**세션 안에서는 거의 일정한데(0.4~1.4s) 세션끼리는 0.6초~21초로 제각각이다.** 한 세션의 시계열을 보면
첫 델타에서 이미 20,861ms가 벌어져 있고 그 뒤로 늘지 않는다 — 공백이 초반에 몰렸다는 뜻이다.

**시계 스큐가 아니다.** `occurredAt`·`audioStartedAt`·`streamElapsedMs` 셋 다 에이전트가 자기 시계로
찍으므로 GPU↔Spring 차이는 상쇄된다. 에이전트 내부에서만 봐도 벌어져 있다.

## 결정

### 1. 소비자는 `anchoredSessionMs`를 쓰지 않는다

FE는 근사 축(`sessionMs` = `occurredAt − clockOriginAt`)으로 돌아간다. 필드는 계속 내려 준다 —
운영에서 두 축을 나란히 놓고 비교할 수 있어야 후속 검증이 가능하다.

**덜 정확해도 어긋나지 않는 축을 고른다.** 근사 축의 오차는 STT 지연 하나뿐이고 실측 0.6~1.7초다
(공백이 거의 없던 두 세션). 앵커 축은 공백만큼 어긋나며 그 폭이 세션마다 달라 상수로 못 메운다.

### 2. `CAPTION_STT_LAG_MS`는 그대로 둔다

1,500ms는 ADR-0045가 추정으로 넣은 값인데, 이번 실측(576ms·1,719ms)이 그 범위를 지지한다. 바꿀
근거가 없다.

### 3. 근본 해결은 벽시계 스탬프다 — 후속 계약

에이전트는 프레임을 받는 순간의 시각을 이미 알고 있다(`audio_source.py`의 `self._clock()`). 지금은
**첫 프레임에서만** 쓰고 버린다. 세그먼트 경계마다 벽시계를 실어 주면 공백·지연과 무관한 정확한
시각이 된다. 앵커 산술도 보정 상수도 필요 없어진다.

계약 초안은 실제 구현·테스트로 확인한 뒤 별도 문서로 연다.

## 결과

- 라이브·다시보기 자막 싱크가 ADR-0104 이전 상태로 돌아온다(오차 ~1.5초).
- `anchored` 플래그와 seek 오프셋 상수가 사라진다 — 세우는 곳이 없어져 죽은 코드가 된다.
- **AI 근거 경로에 같은 오류가 남아 있다.** `ReplayAiContextService`가 동일하게
  `anchor + startStreamElapsedMs`를 쓴다. 다시보기 AI가 인용하는 자막의 시각이 같은 크기로 틀리고,
  질문 시점 주변 자막을 고르는 창도 밀린다. 표시 경로와 별개라 이 MR 범위 밖이며, 후속 계약이
  들어오면 같이 풀린다.

## 배운 것

`ReplayAiContextService`가 이미 같은 변환을 하고 있어 **검증된 것으로 간주**하고 표시 경로로 옮겼다.
그쪽은 몇 초 어긋나도 티가 안 나는 경로였고, 표시로 끌어오면서 처음 드러났다. **다른 코드가 쓰고
있다는 것은 그 값이 맞다는 증거가 아니다.** 생산자 코드를 읽었어야 했다.

## 검증

- `captionStream.test.ts` — `anchoredSessionMs`가 와도 근사를 쓴다(회귀 가드), seek 지연 보정,
  문장 끝 기준 노출, 라벨 = 이동 목표 불변식
- 프런트 65파일 642테스트 통과
