# ADR-0044: FE 라이브 자막 렌더 — 델타 누적 라인 + CaptionView 매핑

> 📍 하네스 개요: [../../harness/README.md](../../harness/README.md) · 아키텍처: [../../ARCHITECTURE.md](../../ARCHITECTURE.md) · 계약: [../../CONTRACT.md](../../CONTRACT.md)

- **상태**: 채택 (FE 구현)
- **일자**: 2026-07-29
- **관련**: [0040](0040-caption-delta-contract.md)(델타 계약), [0043](0043-caption-consumer-persistence.md)(BE consumer·WS 중계), CONTRACT §3-4·§8(FE `docs/frontend/api/LIVE.md`)
- **오너 경계**: FE(자막 구독·누적·렌더) — BE(송정기)가 `/topic/live-sessions/{id}/captions`로 중계하는 델타를 소비만 한다.

## 맥락

BE가 `caption.delta`·`caption.stream.completed`를 STOMP로 브로드캐스트하는데(ADR-0043) FE에 구독·렌더 경로가 없어 자막 독이 늘 비었다. 기존 FE는 세그먼트형 `getCaptions()` REST 스텁(항상 `notImplemented`)에 의존했고, 어댑터(`captionAdapter.ApiCaptionView`)는 옛 `{segmentId,startMs,endMs,text,termReferences}` 세그먼트 모델을 전제해 실제 델타 계약과 형태가 달랐다.

계약 제약(재확인): 이벤트는 **2종뿐**(`caption.segment.final`·`partial|final|revised`는 없음), `streamElapsedMs`는 **stream-local(attempt) ms**로 세션 상대 ms가 아니며(변환 금지), `sequence`는 `(sessionId, sttSessionId)` attempt 범위 증가값, 전달은 at-least-once다.

## 결정

### 1. 채팅 대칭 WS 구독

`subscribeCaptions(sessionId, onEvent, onConnectionChange)`를 채팅 구독과 같은 형태로 추가한다(`httpLiveSessionService`, 같은 `/api/ws`). 봉투를 파싱해 `caption.delta`·`caption.stream.completed`만 넘기고 타 세션·미지 type은 무시한다. 인터페이스·mock 서비스도 대칭 갱신한다. 구독 인가는 서버 인터셉터가 처리하므로 FE는 토픽 구독만 한다.

### 2. `sttSessionId`별 델타 누적 라인

델타는 append-only 증분이고 세그먼트 경계가 계약에 없으므로 **`sttSessionId` 하나 = 한 자막 라인**으로 본다. `sequence` 순서로 텍스트를 이어 붙여 실시간으로 자라는 라인을 만든다(`captionAdapter.reduceCaptionStream`/`selectCaptionViews`, 순수 함수로 단위 테스트). 늦게 온 델타는 sequence로 정렬하고, 같은 sequence 중복 전달은 멱등하게 무시한다. `caption.stream.completed`를 받으면 그 라인을 확정(`pending=false`)한다.

### 3. `streamElapsedMs`는 변환 없이 그대로

계약대로 세션 상대 ms로 변환하지 않는다. `CaptionView.startMs/endMs`에 raw `streamElapsedMs`(라인 내 최소/최대)를, `at` 라벨에 `streamElapsedMs`를 그대로 포맷해 넣는다. 시간축 앵커(세션 ms 변환)는 후속 공유 계약(ADR-0040 보강안)이라 FE는 앞서가지 않는다.

### 4. 기존 CaptionView로 매핑 + 최소 확장

세그먼트형 필드가 없는 델타를 `CaptionDock`이 쓰는 `CaptionView`로 매핑한다: `segmentId=sttSessionId`(안정 key), `termReferences=[]`(델타에 용어 참조 없음), 신설 옵션 필드 `pending?`(확정 전 라이브 라인). `CaptionDock`은 `pending`이면 `is-pending`/`aria-busy`로 진행 중임을 표시하고, 옵션 `note`로 연결 상태를 헤더에 안내한다. 다시보기(세그먼트형) 경로는 `pending` 미설정이라 그대로 동작한다.

### 5. REST 스텁 의존 제거

`LiveClassroomPage`의 `getCaptions` useQuery(항상 실패)를 걷어내고 WS 누적 상태로 자막을 구동한다. `getCaptions`(CAPTION-01) 메서드 자체는 미구현 복구 경로로 남긴다. 자막 구독 실패는 진입 게이트를 막지 않는다 — 미디어·채팅은 자막 없이도 살아 있어야 한다.

## 근거

- **계약 정합**: 실제 발행 이벤트(델타/종료 2종)를 그대로 소비한다. 옛 세그먼트 모델을 흉내 내려 변환을 지어내지 않는다.
- **지연**: 델타를 받는 즉시 라인을 키운다 — 세그먼트 완성 대기가 없어 라이브 체감 지연이 최소다.
- **변환 금지 준수**: stream-local ms를 그대로 표시해, 시계 앵커가 없는 지금 잘못된 세션 싱크를 만들지 않는다.

## 남은 이슈

- **자막↔영상 seek**: `CaptionView.startMs`가 stream-local ms라 `CaptionDock`의 seek/`is-current`(세션 ms 기준)와 의미가 어긋난다. 세션 ms 앵커(ADR-0040 보강 2) 확정 전까지 라이브 자막의 시각 클릭 seek는 부정확하다 — 앵커가 생기면 매핑에서 변환한다.
- **라인 세분화**: 세그먼트 경계 이벤트가 없어 한 attempt가 한 긴 라인이 된다. `caption.segment.final`이 계약에 들어오면 라인을 문장 단위로 쪼갠다.
