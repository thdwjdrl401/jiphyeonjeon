# ADR-0045: 라이브 자막 위치 동기화 — 근사 세션-ms(occurredAt 기반)

> 📍 하네스 개요: [../../harness/README.md](../../harness/README.md) · 아키텍처: [../../ARCHITECTURE.md](../../ARCHITECTURE.md) · 계약: [../../CONTRACT.md](../../CONTRACT.md)

- **상태**: 채택 (BE+FE 구현)
- **일자**: 2026-07-30
- **관련**: [0040](0040-caption-delta-contract.md)(델타 계약), [0043](0043-caption-consumer-persistence.md)(BE consumer·WS 중계), [0044](0044-fe-caption-delta-rendering.md)(FE 델타 렌더), [0039](0039-replay-playback-api.md)(재생 세션-ms 축), CONTRACT §3-4·§3-6·§2 자막, FE [`docs/frontend/api/LIVE.md`](../../frontend/api/LIVE.md)
- **오너 경계**: BE(송정기)가 근사 `sessionMs`를 WS/REST에 실어 주고, FE가 뷰어별로 위치 동기화·리로드 시드를 한다. AI 시간 앵커는 후속 공유 계약.

## 맥락

자막은 WS로 실시간 append되는데(ADR-0043·0044) 학생은 HLS(~수초~수십초 지연) 영상을 본다. 그래서 자막이
영상보다 **앞서** 떠 버린다 — 아직 화면에 오지 않은 발화의 자막이 먼저 보인다. 자막을 **미디어 시각(세션-ms)**에
두고 플레이어 위치에 맞춰 노출해야 싱크가 맞는다.

문제는 자막 델타의 유일한 시간 필드가 `streamElapsedMs`(agent 첫 오디오 프레임=0 기준 **attempt-local** ms)라는
점이다. CONTRACT §3-4는 **"앵커 없이 streamElapsedMs→세션ms 변환·중계 금지"**를 명시한다(ADR-0043) — 세션 시작과
STT attempt 시작이 다르고 retry마다 0으로 리셋되므로, 이걸 세션 축으로 바꾸면 틀린다.

하지만 자막 델타에는 절대시각 `occurredAt`이 있고, 세션에는 클록 원점 `clockOriginAt`(t0)이 있다(재생 세션-ms의
기준과 같은 t0, ADR-0039). 이 둘로 세션 축을 **근사**할 수 있다.

## 결정

### 1. 근사 세션-ms를 occurredAt 기반으로 도입(streamElapsedMs 변환이 아니다)

```
근사 세션-ms = max(0, Duration.between(session.clockOriginAt, caption.occurredAt).toMillis())
             (clockOriginAt이 null이면 null)
```

이는 §3-4 결정의 **의도적 편차**다. 우리는 금지된 `streamElapsedMs`를 변환하지 않는다 — 대신 **occurredAt 기반의
별도 근사 축**을 라이브 **표시용**으로만 만든다. `streamElapsedMs`는 계약대로 raw 그대로 함께 노출한다(변환·삭제 없음).

- **오차**: STT 지연 + GPU↔Spring 시계 스큐로 ~1~2s. 그러나 영상 싱크에 쓰는 HLS 지연(수초~수십초)에 비해 작아
  라이브 표시엔 충분하다. 시계 스큐로 음수가 나오면 0으로 clamp한다(미디어 타임라인은 0 이전이 없음, `ChatService.elapsedMs`와 동형).
- **정밀화**는 AI 시간 앵커(streamElapsedMs↔세션 offset 매핑)를 기다린다. 앵커가 생기면 근사 계산을 앵커 기반으로
  교체하되 WS/REST 필드(`sessionMs`)는 그대로 유지한다.

### 2. DB 마이그레이션 없음 — 읽기 시 계산

`occurred_at`은 이미 `core.live_caption`에 영속된다(ADR-0043). `clockOriginAt`은 `live_session`에서 조회한다.
새 컬럼·마이그레이션 없이 **읽는 시점에** 근사 세션-ms를 계산한다. clockOriginAt은 LIVE 전환에서 한 번 정해지면
불변이라 세션별로 캐시한다(`SessionClockLookup`). 계산 순수 함수는 `CaptionSessionMs.approximate`(단위 테스트).

### 3. WS/REST 페이로드에 `sessionMs`(nullable) 추가, 서로 정합

- **WS**: `caption.delta`·`caption.stream.completed` payload에 `sessionMs`(Long, nullable) 추가
  (`WsCaptionBroadcaster`가 occurredAt으로 계산). raw `streamElapsedMs`는 유지.
- **REST 리로드**: `GET /api/live-sessions/{sessionId}/captions`(CAPTION-01) 신설 — 저장된 자막을 세션-ms 순으로,
  각 행에 근사 `sessionMs`를 계산해 **WS payload와 같은 필드**로 반환한다. 인가는 세션 참가자(`LiveAccessGuard.requireCanAccess`).
  FE가 이 목록을 WS 누적기에 그대로 시드해 새로고침·재연결 뒤 자막을 복원한다(WS 델타와 멱등 병합).

### 4. FE 뷰어별 렌더 분기

- **학생(HLS/replay, 플레이어 위치 존재)**: 자막 startMs를 `sessionMs` 축으로 두고(`synced=true`), 플레이어
  `positionMs`(+STT 지연 보정)까지의 자막만 노출한다. 앞선 자막은 누적기(버퍼)에 두고 위치가 도달하면 드러난다 —
  HLS 지연으로 자막은 항상 미리 와 있어 늦을 일이 없다. 현재 cue는 위치에 도달한 마지막 라인으로 강조한다.
- **강사(라이브, 위치 미구동)**: 기존 실시간 append 그대로.
- 분기 기준: `isInstructor`. `sessionMs`가 없으면(clockOriginAt 전 등) streamElapsedMs로 fallback하고 `synced=false`라
  위치 동기화 대상에서 빼 그대로 노출한다(라이브 append처럼).

### 5. STT 방출 지연 보정 — 단일 상수로 노출·seek을 함께 푼다

근사 sessionMs는 `occurredAt`(agent가 조각을 **내보낸** 시각) 기반이라 실제 발화보다 STT 처리 시간만큼 **늦다**
(`startMs ≈ 발화시각 + lag`). 이 체계적 편향이 두 곳에 같은 크기로 나타나므로 상수 하나(`CAPTION_STT_LAG_MS`=1,500)로 상쇄한다.

- **노출 시점**: `positionMs >= startMs − lag`에서 노출해야 말이 들리는 순간에 자막이 뜬다(보정 없으면 소리보다 늦게 뜬다).
- **seek 목표**: 시각 라벨 클릭 시 `startMs − lag`으로 이동해야 문장 **시작**에 닿는다(보정 없으면 문장 앞부분을 지나친 곳에 떨어져 "정확히 못 찾아간다"). 라벨 텍스트는 자막 시각 그대로 보인다.

두 곳이 같은 값이라, 자막을 눌러 seek한 직후에도 그 줄이 노출 경계에 정확히 걸려 사라지지 않는다. 세그먼트형
(다시보기) 자막은 정확한 구간 시각이라 보정하지 않는다(`synced`가 아닌 경우). 앵커가 확정되면 이 보정은 불필요해진다.

덧붙여 **델타 귀속**도 바로잡는다: 한 델타의 시각은 그 조각을 내보낸 시점이므로, 그 조각의 말이 **시작된** 시점은
직전 델타의 시각에 가깝다. 그래서 각 델타의 시작 시각으로 직전 델타의 시각을 쓴다 — 그러지 않으면 뒤 델타에서
시작하는 문장의 시작이 한 조각만큼 더 늦게 잡힌다.

### 6. Bounded 누적(롤링 캡)

긴 세션에서 메모리·DOM이 무한정 커지지 않게 FE 누적기를 최근 `CAPTION_MAX_LINES`(=300) 라인으로 캡한다 —
초과 시 가장 오래된 라인부터 drop. 학생 위치 동기화에 필요한 앞선 버퍼는 HLS 지연분(~수십초)뿐이라 이 캡이면
넉넉하다. 풀 가상 스크롤은 과해서 쓰지 않는다.

## 근거

- **싱크 정확도 vs 가용성**: 앵커가 없는 지금도 occurredAt 근사로 "영상보다 앞서는" 큰 오류(수초~수십초)를 없앤다.
  근사 오차(~1~2s)는 남지만 방향이 맞고, 앵커가 오면 무접점 교체된다.
- **계약 준수**: 금지된 streamElapsedMs 변환을 하지 않는다. raw 값은 그대로 두고 근사 축을 **덧붙인다**. WS와 REST가
  같은 필드라 FE 한 경로로 소비한다.
- **비용 최소**: 새 컬럼·마이그레이션 없이 읽기 계산 + 세션별 clockOriginAt 캐시.

## 남은 이슈

- **근사 오차·시계 스큐**: sessionMs는 ±(STT 지연+시계 스큐) 근사다. §5의 보정은 지연의 **평균적 크기**를 상수로
  상쇄할 뿐이라 발화·부하에 따라 남는 오차가 있다. 정밀 싱크는 AI 시간 앵커 대기(그전까지 라이브 전용 표시용).
- **보정 상수 튜닝**: `CAPTION_STT_LAG_MS`는 실측 없이 잡은 값이다. 실사용 로그로 방출 지연 분포를 재서 조정하거나,
  앵커가 오면 상수 자체를 제거한다.
- **축 정합 가정**: 학생 위치 `positionMs`(재생 `availableFromMs` 기준, ADR-0039)와 자막 `sessionMs`(clockOriginAt 기준)가
  **같은 t0**을 공유한다고 가정한다. 재생 축과 clockOriginAt이 어긋나면 자막이 통째로 offset된다 — 앵커 도입 시 함께 정합 확인.
- **오래된 이력 리로드-온디맨드**: 롤링 캡을 넘어 drop된 오래된 자막을 스크롤로 다시 불러오는 것은 이번 범위 밖(후속).
