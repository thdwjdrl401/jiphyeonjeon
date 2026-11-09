# ADR-0053: 자막 세그먼트 전달·렌더, segment.final WS/REST + FE 권위 렌더

> 📍 하네스 개요: [../../harness/README.md](../../harness/README.md) · 아키텍처: [../../ARCHITECTURE.md](../../ARCHITECTURE.md) · 계약: [../../CONTRACT.md](../../CONTRACT.md)

- **상태**: 채택 (BE·FE 구현)
- **일자**: 2026-07-31
- **관련**: [0052](0052-caption-segment-anchor-consumption.md)(영속 1차), [0043](0043-caption-consumer-persistence.md)(소비·WS), [0044](0044-fe-caption-delta-rendering.md)(**이 ADR이 휴리스틱 부분을 supersede**), [0045](0045-live-caption-position-sync-approx-session-ms.md)(근사 세션-ms), CONTRACT §3-4·§3-6, MR `!233`(producer)
- **오너 경계**: BE(송정기) — WS/REST 전달 / FE(윤광혁·서민경) — 세그먼트 렌더 / AI(유채은) — 발행(완료)

## 맥락

ADR-0052로 `caption.segment.final`(발화 경계·권위 텍스트)·`caption.stream.started`(시간 앵커)를 **영속만** 했다(표시 경로는 delta/completed로 고정). 그 결과 FE는 여전히 ADR-0044의 **문장부호 휴리스틱**(`splitSentences` 정규식)으로 delta를 근사 분할했는데, 이는 부정확하고 발화별 정확한 시각을 못 준다.

`segment.final`은 그 근사를 대체할 **권위 데이터**(확정 텍스트 + 실제 발화 시각)를 준다. 이 ADR은 그 데이터를 FE까지 흘려 휴리스틱을 걷어낸다.

## 결정

### 1. BE — segment.final을 표시 경로에 편입

- 표시 대상 집합을 둘로 나눈다. `RELAYED_TYPES = {delta, completed, segment.final}`(WS 중계·REST 리로드)와 `CONTEXT_TIME_TYPES = {delta, completed}`(RAG `contextTimeMs`의 단일 `streamElapsedMs` 좌표). `segment.final`은 단일 좌표가 없어 RAG에선 제외한다(최신행이 되어 좌표 null이 되는 회귀 방지, ADR-0052에서 도입한 필터를 유지).
- WS: `WsCaptionBroadcaster`가 type로 분기해 `segment.final`은 신규 `CaptionSegmentPayload`(sttSessionId·segmentIndex·lastSequence·text·start/endStreamElapsedMs·boundaryReason·근사 sessionMs)로 브로드캐스트한다. `caption.stream.started`(앵커)는 **표시 대상 아님** — 영속만 하고 WS/REST로 내보내지 않는다.
- REST: 리로드가 `segment.final` 행을 포함하고 `CaptionReloadItem`에 세그먼트 필드를 싣는다 — FE가 새로고침·재연결 뒤 권위 세그먼트를 복원한다.
- `streamElapsedMs`(및 start/end)는 raw 그대로 전달한다(변환 금지, CONTRACT §3-4).

### 2. FE — 권위 세그먼트 렌더 + delta는 진행중 부분만

- `sttSessionId` 라인당 렌더는 **① 받은 `segment.final`마다 한 라인**(권위 `text`, `startMs=startStreamElapsedMs`, 확정=`pending:false`, 안정 key `sttSessionId#segmentIndex`) **+ ② 아직 어떤 세그먼트에도 확정 안 된 뒷쪽 delta(=`sequence > max(lastSequence)`)를 한 개의 진행중 라인**(`pending:true`)으로 만든다.
- `segment.final`이 늦게 도착해 그 delta들을 덮으면 진행중 라인이 줄어들며 권위 라인으로 확정·대체된다("delta는 진행 렌더용, segment.final이 확정" 계약).
- **`splitSentences`(문장부호 정규식)·`endsFinal` 제거** — 경계는 이제 서버 권위값이다. `streamElapsedMs` 무변환·rolling cap·멱등·`synced`/seek 위치 계층은 유지한다.

## 대안

| 대안 | 판단 |
|---|---|
| 휴리스틱 유지 + segment.final 무시 | 부정확·발화 시각 없음. producer가 이미 권위값을 주는데 근사를 유지할 이유 없음 → 기각 |
| segment.final만 렌더(delta 진행 라인 제거) | 발화 확정 전 자막이 안 보여 라이브 체감 지연 증가 → 기각(delta로 진행 부분 유지) |
| started 앵커까지 이번에 전달·세션-ms 정밀화 | seek 정밀화는 별도 관심사(ADR-0045 대체)라 범위 분리 → 후속 |

## 영향·후속

- **무회귀**: delta/completed 경로·RAG 불변. segment.final은 추가 표시로만 편입.
- **한계(의도)**: 확정 세그먼트 뷰는 raw stream-local 축(`startStreamElapsedMs`)에 일관되게 두고 `synced=false`로 낸다 — 학생 위치 게이팅(`selectVisibleCaptions`)의 세션-ms 축이 아니라 재생 위치와 무관하게 노출된다. 진행중 델타 조각은 종전대로 근사 sessionMs로 게이팅한다. 세그먼트를 세션 축으로 정확히 올리려면 start/end를 앵커로 일관 변환해야 하므로 반쪽 변환(축 혼합)을 피하고 아래 후속으로 미룬다.
- **후속**: `caption.stream.started` 앵커 기반 정밀 세션-ms·seek·세그먼트 위치 게이팅(ADR-0045 근사 대체) — 별도 슬라이스.

## 계약 테스트

- BE: `LiveCaptionStreamContractTest`가 `RELAYED_TYPES`(3종 노출)·`CONTEXT_TIME_TYPES`(RAG 2종) 분리를 고정.
- FE: `captionStream.test.ts`가 segment.final당 권위 CaptionView, 미확정 delta의 진행중 라인, segment.final의 대체를 고정. `liveCaptionSubscription.test.ts`가 WS segment.final passthrough를 고정.
