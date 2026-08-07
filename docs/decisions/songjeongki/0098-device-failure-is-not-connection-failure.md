# ADR-0098: 장치 실패는 연결 실패가 아니다

> 관련 결정: [ADR-0021 모노톤 UI](../yoongwanghyeok/0021-modern-ink-monotone-curation-ui.md) ·
> [ADR-0092 종료 후 강의 상세로](../seominkyeong/0092-live-end-returns-to-lesson-detail.md)

- **상태**: 채택
- **일자**: 2026-08-07
- **적용 범위**: 강사 송출 장치(마이크·카메라·화면공유) 실패 처리 — 사전 점검 화면과 라이브 화면

## 맥락

운영에서 강사 사전 점검 화면이 이렇게 떴다.

```
연결 실패
Requested device not found          [다시 연결]
```

**전부 틀린 말이었다.** 브라우저에서 직접 확인한 그 시점의 상태는 이렇다.

```json
{ "secure": true, "micPerm": "granted", "camPerm": "granted",
  "devices": [ { "kind": "videoinput", "label": "Camera Sensor OV02C10" } ] }
```

권한은 이미 허용돼 있었고(`granted`), LiveKit 방에는 **이미 들어가 있었다**. 실제 원인은 그 컴퓨터에
오디오 입력 장치가 하나도 없다는 것 하나뿐이었다. 그런데 화면은 라이브킷이 죽었다고 말하고 있었다.

원인은 코드에 있었다. 마이크를 켜는 호출이 **연결 try 안에** 있었다.

```tsx
await room.connect(wsUrl, token, { autoSubscribe: false })   // 성공
setState(… connectionState: 'connected' …)                    // 성공
await room.localParticipant.setMicrophoneEnabled(true)        // 여기서 던진다
try { await room.localParticipant.setCameraEnabled(true) }
catch (error) { … describeMediaError(error) }                 // 카메라만 따로 받고 있었다
```

던져진 오류가 연결 실패 catch로 흘러 세 가지가 한꺼번에 무너졌다.

1. **메시지가 원문으로 샜다.** 장치용 변환기(`describeMediaError`)는 한국어로 옮겨 주는데, 연결용
   변환기는 `error.message`를 그대로 흘린다.
2. **멀쩡한 방을 끊었다.** catch가 `room.disconnect(true)`를 부른다.
3. **마이크 버튼이 잠겼다.** `canControl`이 `connected`일 때만 참이라, 장치를 꽂고도 마이크만 다시
   켤 수 없고 전체 재연결밖에 남지 않았다.

더 깊은 문제는 **권한과 장치를 구분하지 못한다**는 것이었다. 브라우저는 "차단됨"과 "권한 창을 닫음"에
같은 오류(`NotAllowedError`)를 던진다. 앞은 다시 눌러도 창이 뜨지 않고 뒤는 뜬다. 오류만 보고는
가를 수 없어, 예전 코드는 둘 다 "권한을 허용한 뒤 다시 시도해 주세요"라고 말했다 — 차단된 강사에게는
**아무 일도 일어나지 않는 버튼**을 쥐여 준 셈이다.

## 결정

### 1. 두 축을 분리한다

상태에 칸을 나눈다. `errorMessage`는 **방 연결**만, `mediaFailure`는 **장치**만 담는다. 장치를 여는
일은 연결 try 밖으로 꺼내 자체적으로 끝낸다(`openLocalDevices`). 장치가 안 열려도 방은 유지한다.

### 2. 원인을 오류와 권한 상태의 조합으로 확정한다

`describeMediaFailure(error, kind, permission)` 하나가 판정한다. 순수 함수라 표로 고정했다.

| 오류 이름 | 권한 | 원인 | 다시 시도 | 강사가 할 일 |
|---|---|---|---|---|
| `NotAllowedError` | `denied` | `blocked` | **안 준다** | 사이트 설정에서 허용으로 바꾸기 |
| `NotAllowedError` | 그 밖 | `dismissed` | 준다 | 권한 창에서 허용 |
| `NotFoundError` | — | `no-device` | 준다 | 장치 연결(꽂으면 자동 재시도) |
| `NotReadableError` | — | `in-use` | 준다 | 다른 프로그램 닫기 |
| `OverconstrainedError` | — | `overconstrained` | 준다 | 송출 품질 낮추기 |
| `SecurityError`·`TypeError` | — | `unsupported` | 안 준다 | https로 접속 |
| `NotAllowedError`(화면공유) | — | `canceled` | — | **아무것도** — 실패가 아니다 |

**차단(`blocked`)에서 "다시 시도"를 내주지 않는 것이 이 표의 핵심이다.** 눌러도 달라지지 않는 버튼은
브라우저 밖에서 할 일이 있다는 사실을 감춘다.

화면공유의 `NotAllowedError`는 **선택 창을 닫은 것**이라 오류로 취급하지 않는다. 예전에는 공유를
취소할 때마다 "권한이 거부되었습니다"가 떴다.

분류에 없는 오류는 제목만 우리 말로 세우고 **원문을 본문에 남긴다** — 그때는 그 한 줄이 유일한 단서다.

### 3. 요청하기 전에 가려낼 수 있는 것은 미리 가려낸다

권한이 `denied`이거나 오디오 입력 장치가 0개면 **요청하지 않고** 바로 안내한다. 차단 상태에서 요청을
보내면 브라우저가 조용히 거절해, 강사 눈에는 화면이 그냥 멈춘 것으로 보인다.

장치 존재는 `enumerateDevices()`로 본다 — 권한 전에는 라벨이 비지만 **존재 여부는 알 수 있고**, 그것이
이 사건의 결정적 단서였다. 조회를 지원하지 않는 브라우저에서는 `'unknown'`이며, **모른다를 없다로
읽지 않는다**(막지 않고 그냥 요청한다).

### 4. 권한과 장치 변화를 지켜보고 스스로 회복한다

- 사이트 설정에서 허용으로 바꾸면 → 새로고침 없이 다시 시도한다.
- 마이크를 꽂으면(`devicechange`) → 다시 시도한다.
- **"이번만 허용"이 끝나면** → 브라우저가 트랙을 끊는다. 그때 알린다.

자동 재시도는 **우리가 마이크 실패를 보고해 둔 경우로만** 제한한다. 그러지 않으면 강사가 일부러 끈
마이크를 이어폰 연결 같은 사건이 제멋대로 다시 켠다.

### 5. 다시 시도는 장치만, 다시 연결은 방만

`retryMedia()`는 실패한 장치만 다시 연다(방은 그대로 두므로 강의 중에도 안전하다). `retry()`는 예전대로
방 전체를 다시 붙인다. 서로 다른 사건이고 고치는 방법도 다르다.

### 6. 사전 점검에 "마이크 권한"을 항목으로 세운다

권한 상태(`허용됨`·`차단됨`·`확인 필요`·`확인 불가`)를 점검 목록에 올린다. 이것이 없으면 "마이크 송출
대기"만 계속 보여, **기다리면 되는 상태인지 강사가 손대야 하는 상태인지** 구분되지 않는다.

차단은 기다린다고 풀리지 않으므로 대기(warning)가 아니라 실패(danger)로 그린다. 같은 이유로 장치
실패가 떠 있는 동안에는 "자동으로 시작합니다" 문구와 "기다려 주세요" 문구를 **그 실패의 조치 문장으로
바꾼다**.

## 결과

- 마이크가 없는 컴퓨터에서 강사가 보는 것: **"마이크를 찾지 못했습니다 / 권한 문제가 아닙니다"**.
  연결 상태는 `연결됨`으로 남고, 마이크를 꽂으면 저절로 이어진다.
- 차단된 강사가 보는 것: 무엇을 어디서 바꿔야 하는지. 헛도는 버튼은 없다.
- 화면공유를 취소해도 붉은 경고가 뜨지 않는다.
- FE/BE 공유 계약은 **바뀌지 않았다**. 새 엔드포인트도 필드도 없다.

## 검증

- `mediaFailure.test.ts` **14건** — 위 판정표 전체 · 운영에서 난 `Requested device not found`가
  `no-device`로 가는지 · 차단에서 `retryable=false`인지 · 권한 조회 미지원 브라우저에서 `unknown`인지 ·
  분류에 없는 오류가 원문을 남기는지.
- `InstructorLiveMediaProvider.test.tsx` **+8건** — 던져진 오류가 방을 끊지 않는지(`disconnect` 미호출,
  `connectionState === 'connected'`, `canControl === true`) · 차단이면 `setMicrophoneEnabled`를
  **부르지도 않는지** · `retryMedia`가 `room.connect`를 다시 부르지 않는지 · `devicechange`와 권한
  변화에서 스스로 회복하는지 · 송출 중 허용이 걷히면 알리는지.
- **돌연변이 확인**: 마이크 catch를 옛날처럼 다시 던지게 바꾸면 **2건이 깨진다**(운영에서 난 그
  경로를 포함해).
- 프런트 **1,144건** 통과 · typecheck·lint 통과.
- 표시 확인은 브라우저에서 직접 했다(장치 없음·권한 차단·라이브 무대 겹침 세 상태). 겹침용 톤 규칙은
  `design-system.css`에 둔다 — 그 파일이 맨 뒤에 로드되므로 `learning.css`에 두면 base 규칙이 같은
  특이도로 덮는다(ADR-0021 §8 주석이 `.inline-notice`에서 같은 사고를 기록해 두었다).
