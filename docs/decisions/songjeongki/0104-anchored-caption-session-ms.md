# ADR-0104: 자막 세션-ms를 앵커로 정밀화하고, 근사값을 지우지 않는다

> 📍 하네스 개요: [../../harness/README.md](../../harness/README.md) · 아키텍처: [../../ARCHITECTURE.md](../../ARCHITECTURE.md) · 계약: [../../CONTRACT.md](../../CONTRACT.md)

- **상태**: **철회** — [ADR-0106](0106-caption-time-axis-is-wall-clock-not-audio.md)이 대체한다.
  `앵커 + streamElapsedMs`가 성립하지 않는다. `streamElapsedMs`는 벽시계가 아니라 **받은 오디오의 누적
  길이**라(realtime-agent `audio_source.py`), 무음·뮤트로 프레임이 오지 않은 만큼 계속 뒤처진다. 운영
  데이터에서 세션마다 **0.6초~21초** 이르게 어긋났다. 이 문서의 전제("앵커 + streamElapsedMs = 정확한
  세션-ms")가 틀렸다. BE는 필드를 계속 내려 주되 소비자는 쓰지 않는다.
- **일자**: 2026-08-08
- **관련**: [0045](0045-live-caption-position-sync-approx-session-ms.md)(근사 세션-ms — 이 문서가 그 "후속"이다),
  [0052](0052-caption-segment-anchor-consumption.md)(앵커 영속), [0053](0053-caption-segment-delivery-and-render.md)(세그먼트 전달·렌더 — §후속으로 이 작업을 예고),
  [canola/0042](../canola/0042-replay-ai-caption-context-contract.md)(AI 근거 경로의 앵커 적용), CONTRACT §3-4·§3-6, FE [`LIVE.md`](../../frontend/api/LIVE.md), MR `!516`(축 정렬 선행)
- **오너 경계**: BE(송정기)가 `anchoredSessionMs`를 WS/REST에 실어 주고, FE가 있으면 그것을 쓴다. AI 근거 경로는 이미 앵커를 쓰고 있어 변경 없음.

## 맥락

자막 시각에 축이 셋이고 원점이 전부 다르다.

| 축 | 0이 가리키는 것 |
|---|---|
| 세션 | `clockOriginAt`(LIVE 전환) |
| 미디어 | 녹화 시작(`availableFromMs`) |
| STT stream-local | 그 attempt가 붙은 순간 |

ADR-0045는 `occurredAt − clockOriginAt`로 **근사** 세션-ms를 만들어 학생 위치 동기화를 열었다. 근사인 이유는
그때 앵커가 없었기 때문이고, 문서는 "정밀화는 AI 시간 앵커를 기다린다"로 닫았다.

**그런데 앵커는 이미 와 있었다.** ADR-0052로 `caption.stream.started`(그 attempt 첫 오디오 프레임의 절대시각
`audioStartedAt`)를 영속하고 있고, `ReplayAiContextService`는 AI 근거를 만들 때 `앵커 + startStreamElapsedMs`로
정확히 환산한다. 다만 ADR-0053이 앵커를 **표시 대상에서 제외**했고(영속만), 그 §후속에 남은 것이 이 작업이다.

그 사이 표시 경로는 근사만 썼고, 근사가 도착 시각 기준이라 발화보다 늦는 편향을 상수 하나
(`CAPTION_STT_LAG_MS` = 1,500)로 상쇄하고 있었다. 값의 근거는 "STT 지연 ~1~2초"라는 **추정**이다.

## 결정

### 1. `anchoredSessionMs`를 덧붙인다 — `sessionMs`를 덮어쓰지 않는다

WS payload 3종(`caption.delta`·`caption.segment.final`·`caption.stream.completed`)과 리로드 응답에
`anchoredSessionMs`(Long, nullable)를 추가한다.

```
앵커(attempt) = audioStartedAt − clockOriginAt
anchoredSessionMs = max(0, 앵커 + streamElapsedMs)
```

**같은 필드를 덮어쓰지 않는 것이 이 ADR의 핵심 판단이다.** 두 값은 크기가 다른 게 아니라 **성질이 다르다** —
근사값은 도착 시각 기준이라 발화보다 늦어 보정이 필요하고, 앵커값은 발화 시각 그 자체라 보정하면 오히려
그만큼 이르게 어긋난다. 한 필드에 담으면 소비자가 **어느 쪽을 받았는지 알 수 없어** 보정 여부를 판단하지
못한다. 필드의 존재 자체가 "정확하다"는 신호가 되게 한다.

부수적으로 앵커가 없는 옛 세션이 종전대로 동작하고, 운영에서 두 값을 나란히 비교해 앵커를 검증할 수 있다.

### 2. `segment.final`은 **시작** 좌표를 태운다

세그먼트에는 좌표가 둘(`startStreamElapsedMs`·`endStreamElapsedMs`)이라 어느 쪽을 실을지 정해야 한다.
**시작이다** — 노출 경계도 seek 목표도 "발화가 시작된 시각"을 쓴다. 끝은 소비자가 구간 길이를 더해 얻는다
(길이는 어느 축에서도 같다).

### 3. FE는 앵커가 있으면 지연 보정을 걸지 않는다

`CaptionView`에 `anchored`를 더해 축의 **품질**을 표현한다. `synced`는 "세션 축인가"(노출 게이팅 대상인가)로
그대로 두고, `anchored`는 "그 값이 정확한가"다. `anchored`면 노출 상한이 `positionMs` 그대로이고
`captionSeekMs`도 보정 없이 `startMs`를 돌려준다.

`CAPTION_STT_LAG_MS`는 **지우지 않는다.** 앵커 없는 세션에서는 여전히 필요하고, 그 경로가 사라졌다는 증거가
아직 없다. 앵커가 모든 세션에 있음이 운영에서 확인되면 그때 상수와 함께 근사 경로를 걷어낸다.

### 4. 앵커는 attempt 단위로 캐시하고, 없는 것도 기억한다

`CaptionAnchorLookup`이 세션별로 앵커 맵을 캐시한다(`SessionClockLookup`과 같은 이유 — 자막 델타는 빈번하다).
**못 찾은 attempt도 기억한다** — 앵커가 없는 옛 세션에서 델타마다 DB를 다시 뒤지는 것을 막는다. agent는
오디오를 넘기기 전에 반드시 `started`를 먼저 발행하므로 델타가 앵커를 앞지르는 순서는 나오지 않는다.

## 근거

- **CONTRACT §3-4 준수**: 금지된 것은 "앵커 **없이**" streamElapsedMs를 세션ms로 환산하는 것이다. 여기서는
  실제 앵커 행을 읽어 적용한다 — AI 근거 경로가 이미 같은 변환을 한다. raw `streamElapsedMs`는 그대로 둔다.
- **재접속에 안전하다**: 앵커가 attempt 단위라 STT가 재접속해 stream-local이 0으로 리셋돼도 그 attempt의
  앵커가 따로 잡힌다. 근사 축은 이 문제를 우연히 피해 갔을 뿐이다.
- **되돌리기 쉽다**: 필드를 추가만 했으므로 FE가 무시하면 종전 동작이다.

## 고려한 대안

**`sessionMs`를 앵커 기반으로 교체(ADR-0045가 예고한 방식).** 필드가 안 늘어 깔끔하지만, 소비자가 보정
여부를 판단할 수 없다. ADR-0045는 "앵커가 오면 보정이 불필요해진다"를 전제로 교체를 예고했는데, 그 전제는
**모든 세션에 앵커가 있을 때만** 참이다. 옛 세션이 남아 있는 동안은 두 경로가 공존해야 한다.

**앵커를 FE로 내려 FE가 환산.** WS에 `started`를 새로 흘리고 FE가 attempt별 앵커를 관리해야 한다. 환산 규칙이
BE·FE 두 곳에 생기고, 이미 BE가 AI 경로에서 하고 있는 계산을 한 벌 더 만드는 일이다.

**세그먼트에 끝 좌표를 태우기.** 소비자가 매번 길이를 빼야 하고, 그 뺄셈은 이미 근사 경로에서 하던 우회다.
정밀화의 목적이 그 우회를 없애는 것이다.

## 결과

- 자막 노출·seek·현재 cue가 **근사가 아닌 실제 발화 시각**에 걸린다. `CAPTION_STT_LAG_MS` 튜닝 논의가
  앵커 있는 세션에서는 사라진다.
- STT 재접속이 섞인 세션에서도 어긋나지 않는다.
- 앵커 없는 세션은 종전 동작 그대로다(회귀 테스트로 고정).
- **남는 것**: 운영에서 앵커 적용률을 확인해야 한다. 100%가 확인되면 근사 경로와 `CAPTION_STT_LAG_MS`를
  걷어내는 후속을 연다 — 그때까지 두 축이 공존한다.

## 검증

- `CaptionAnchorLookupTest` — 앵커 덧셈, attempt별 분리(재접속), 첫 started가 0을 정함, 음수 clamp,
  앵커·좌표 없음 → null, 세션당 1회 조회, 앵커 없는 세션 재조회 안 함
- `captionStream.test.ts` — 앵커가 근사를 제침, 앵커는 보정 없음(seek·노출 양쪽), 앵커 없으면 근사 경로 유지,
  델타도 앵커 우선. stream-local을 900,000부터 두어 **어느 축을 썼는지 값으로 구분**된다
