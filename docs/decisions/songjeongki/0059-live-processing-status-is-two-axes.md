# ADR-0059: 종료 후 처리 현황은 두 상태축을 접지 않고 그대로 준다

> 관련 결정: [ADR-0003 라이브 종료 순차 처리](../choinhoo/0003-simple-live-end-sequential-process.md) ·
> [ADR-0034 Egress 완료 webhook](0034-egress-completion-webhook.md) ·
> [ADR-0039 다시보기 재생 API](0039-replay-playback-api.md) ·
> [공유 계약](../../CONTRACT.md) · [프론트 라이브 API](../../frontend/api/LIVE.md)

- **상태**: 채택 — 구현됨
- **일자**: 2026-08-02
- **적용 범위**: `GET /api/instructor/live-sessions/{sessionId}/processing` 신설, 강사 종료 후 화면

## 한 줄 결정

종료 후 처리 현황은 **라이브 세션 상태와 녹화 자산 상태를 각각** 돌려주고, 서버는 **상태만** 준다.
`ready` 불리언 하나로 접지 않고, 화면 문구(`steps[].label`)도 응답에 담지 않는다.

## 맥락

### 1. 종료 화면이 항상 오류로 끝나고 있었다

강사가 종료를 누르면 `LiveClassroomPage`가 `/instructor/live-sessions/{id}/processing`으로 이동한다.
그런데 그 화면이 부르는 조회는 FE 어댑터에서 `notImplemented`(501)를 던지고 있었고 서버에도 경로가
없었다. 즉 **정상 종료 경로의 종착지가 오류 화면**이었다.

목(`VITE_USE_MOCK_API=true`)에서는 목 구현이 4단계 진행 상태를 돌려줘 화면이 멀쩡해 보였다.
실서버에서만 깨지는 화면이라 오래 눈에 띄지 않았다.

### 2. 라이브가 끝나도 영상은 아직 끝나지 않았다

ADR-0003이 못박은 대로 라이브 세션과 녹화 자산은 **독립된 상태축**이다. 세션이 `ENDED`가 된 뒤에도
자산은 따로 진행한다.

```text
liveSessionStatus = ENDED        ← 라이브는 끝났다
videoAssetStatus  = FINALIZING   ← 영상은 아직 마무리 중
replayStatus      = DRAFT        ← 다시보기로 낼지는 아직 결정 안 됨
```

`FINALIZING → VERIFYING → READY` 전이는 Egress 완료 webhook(ADR-0034)이 나중에 몰고 온다.
강사에게 이 축을 보여주는 화면이 없으면, 종료 후 영상이 언제 준비되는지·실패했는지 알 방법이 없다.

### 3. 기존 FE 타입은 서버에 표시 문구를 요구했다

```ts
interface ProcessingStatus {
  steps: Array<{ label: string; status: 'COMPLETE' | 'PROCESSING' | 'PENDING' }>
  ready: boolean
}
```

`label`은 "HLS 세그먼트 정리" 같은 **화면 문장**이다. 이걸 계약에 넣으면 문구 한 줄 고치는 데 서버
배포가 필요해진다. `LIVE.md`의 제안 스펙(`videoAsset`·`aiPostProcessing`·`replayStatus`)과도 겹치는
필드가 하나도 없어, 두 문서가 서로 다른 것을 가리키고 있었다.

## 결정

### 1. 두 축을 각각 준다

```json
{
  "sessionId": "...",
  "liveSessionStatus": "ENDED",
  "recordingEnabled": true,
  "startedAt": "...",
  "endedAt": "...",
  "videoAsset": {
    "videoAssetId": "...",
    "status": "READY",
    "replayStatus": "DRAFT",
    "failureCode": null,
    "durationMs": 5520000,
    "sizeBytes": 1284000000,
    "recordingStartedAt": "...",
    "recordingEndedAt": "..."
  }
}
```

`status=READY`는 "재생할 수 있다"이고 `replayStatus=PUBLISHED`는 "수강생에게 공개했다"이다. 서로 다른
사실이라 한 필드로 접지 않는다. 접으면 화면이 "영상은 준비됐지만 게시 전"을 표현할 수 없다.

### 2. 표시 문구는 응답에 담지 않는다

서버는 `status` enum만 준다. 단계 이름·설명·순서는 FE가 갖는다. 계약 테스트가 응답에 `steps`·`ready`·
`label`이 **없음**을 고정한다 — 편의로 되돌아가기 쉬운 자리라서다.

### 3. `videoAsset`은 null일 수 있고, 그 부재는 실패가 아니다

녹화를 켜지 않고 진행했거나 아직 시작 전이면 자산이 없다. `recordingEnabled`를 함께 실어 화면이
"아직 안 만들어졌다"와 "애초에 녹화하지 않았다"를 구분하게 한다. 없는 것을 `FAILED`로 바꾸지 않는다.

### 4. `aiPostProcessing`은 넣지 않는다

`LIVE.md`의 제안 스펙에는 `transcript`·`glossary`·`chapters`·`quiz` 상태가 있었지만, 백엔드에 이를
받쳐줄 코드·테이블이 하나도 없다. 지금 넣으면 그 자리에 또 고정 문구가 들어간다. 실제 산출물이
생길 때 필드를 추가한다.

### 5. 화면은 아직 움직일 상태일 때만 다시 묻는다

`READY`·`FAILED`는 종착 상태라 폴링을 멈춘다. 녹화를 끄고 진행해 자산이 영영 생기지 않는 세션도
멈춘다. 그 외에는 4초 간격으로 다시 읽는다 — webhook이 나중에 도착하므로 한 번 읽고 멈추면 변화를
놓친다.

## 채택하지 않은 대안

### 1. `ready` 불리언 유지

화면 코드가 가장 짧아진다. 그러나 "재생 가능"과 "게시됨"을 구분할 수 없어, 검수·게시 흐름이 붙는
순간 서버 계약을 다시 바꿔야 한다.

### 2. 서버가 `steps[].label`까지 만들어 주기

FE 타입을 그대로 두면 화면을 안 고쳐도 된다. 그러나 문구가 서버 배포에 묶이고, 같은 상태를 두 문장이
설명하게 되는 순간(예: 강사용/관리자용) 계약이 갈라진다.

### 3. WebSocket으로 밀어 주기

`/state` 토픽에 자산 전이를 얹을 수도 있다. 그러나 이 화면은 강사 혼자 잠깐 보는 화면이고, 전이가
분 단위로 드물다. 토픽·구독 인터셉터·재연결 복구를 늘릴 값어치가 없다고 봤다. 필요해지면 그때 옮긴다.

## 결과와 한계

### 장점

- 종료 후 오류 화면이 사라진다. 강사가 녹화 성공·실패를 처음으로 확인할 수 있다.
- 실패 시 `failureCode`가 그대로 보여, 재시도하면 되는지 영상이 날아갔는지 판단할 수 있다.
- 자산이 `READY`가 되면 검수·게시(`POST .../replay-review/publish`, 이미 구현됨)로 갈 수 있다.

### 한계

- 검수 원고 저장(`PUT .../replay-review`)은 여전히 서버에 없다(CP2·CP3 산출물 대기).
- AI 후처리 진행 상태는 이 응답에 없다. 받쳐줄 데이터가 생길 때 추가한다.
- 폴링이라 전이 반영이 최대 4초 늦다. 강사 혼자 보는 화면이라 감수한다.

## 검증

- 백엔드 계약 테스트 `LiveProcessingContractTest` — 두 축 분리, 표시 문구 부재, `FAILED`의 `failureCode`,
  자산 없음이 실패가 아님, 소유권 403·역할 403·404.
- 프론트 `liveSessionProcessing.test.tsx` — 요약이 서버 값으로 채워짐(하드코딩 제거), READY+DRAFT와
  READY+PUBLISHED의 문구 구분, READY 전 링크 미생성, 실패 코드 표시, 자산 없음/녹화 끔 구분.
- 두 축 분리는 응답에서 `replayStatus`를 접어 보고 계약 테스트가 실제로 깨지는 것을 확인했다.
