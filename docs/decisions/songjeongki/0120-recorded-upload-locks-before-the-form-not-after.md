# ADR-0120: 녹화강의 업로드는 폼 뒤가 아니라 폼 앞에서 잠근다

> 관련 결정: [choinhoo/ADR-0011 GMS Whisper 배치 STT](../choinhoo/0011-recorded-lesson-batch-stt-with-gms-whisper.md) ·
> [choinhoo/ADR-0012 HLS·자막 자동 게시](../choinhoo/0012-recorded-lesson-hls-caption-auto-publication.md) ·
> [choinhoo/ADR-0008 녹화강의 업로드](../choinhoo/0008-recorded-lesson-upload-and-hls-transcoding.md)

- **상태**: 채택
- **일자**: 2026-08-10
- **적용 범위**: 강사 녹화강의 업로드 화면과 `recorded.stt.enabled` 스위치의 노출 방식

## 맥락

강사가 물었다 — "녹화된 mp4를 올리면 자막이 발행이 안 된다".

확인해 보니 **자막만 안 붙는 게 아니라 업로드 자체가 되지 않는 상태**였다. 운영 백엔드 컨테이너의
환경변수가 이렇다.

```
RECORDED_VIDEO_ENABLED=true
RECORDED_STT_ENABLED=false      ← 여기
```

그리고 `recorded-stt-worker`는 운영에 떠 있지 않다.

업로드 영상의 자막은 **라이브 자막과 경로가 다르다.** 라이브는 우리가 직접 돌리는 STT 모델이 실시간
으로 만들지만, 업로드 MP4는 [ADR-0011](../choinhoo/0011-recorded-lesson-batch-stt-with-gms-whisper.md)의
배치 경로로 **외부 STT API를 호출량만큼 과금되는 방식**으로 부른다. 비용 때문에 스위치를 닫아 둔 것이다.

`RecordedVideoService.issueUpload()`는 그 스위치를 **업로드 티켓 발급 전에** 본다
([ADR-0012](../choinhoo/0012-recorded-lesson-hls-caption-auto-publication.md)의 fail-closed 게이트 —
자막이 `READY|EMPTY`가 되어야 재생 패키지가 게시되므로, 자막이 닫힌 채 5GiB를 올려 봐야 그 강의는
영원히 `DRAFT`에 남는다). 막는 것 자체는 옳다.

**틀린 것은 막는 시점과 문구였다.**

### 1. 이유를 말하지 않았다

```
녹화강의 자막 생성 기능을 사용할 수 없습니다.
```

왜 못 쓰는지가 없다. 강사는 이걸 **고장으로 읽는다** — 실제로 그렇게 물어 왔다.

### 2. 다 채운 뒤에 막았다

업로드 흐름은 ①레슨 생성 ②자료 연결 ③티켓 발급 ④영상 PUT 순인데, 503은 **③**에서 난다. 그 시점에는
①이 이미 커밋된 뒤라 **영상 없는 강의가 커리큘럼에 남는다.** `clientRequestId` 멱등키는 같은 화면의
재시도만 지키므로, 화면을 나갔다 들어오면 시도할 때마다 하나씩 더 쌓인다.

## 결정

### 1. 문구가 이유와 남은 선택지를 말한다

```
업로드한 영상의 자막은 실시간 강의와 달리 외부 STT API를 호출해 만듭니다.
이 API는 쓴 만큼 요금이 붙어 지금은 잠가 두었습니다.
실시간 강의와 자막은 그대로 사용할 수 있습니다.
```

세 가지를 담는다 — **고장이 아니라 의도된 제한**, **라이브 자막과 다른 경로**, **라이브는 멀쩡하다**.
마지막 줄이 실질적으로 중요하다. 이 안내를 받은 강사가 할 수 있는 일이 남아 있다는 뜻이기 때문이다.

### 2. 화면이 폼을 열 때 스위치를 묻는다

`GET /api/instructor/recorded-lessons/capabilities` →
`{videoUploadEnabled, captionGenerationEnabled}`. 강사 전용이고 DB를 읽지 않는다.

닫혀 있으면 화면이 **입력 전에** 안내하고 제출 버튼을 잠근다. ①레슨 생성에 닿지 않으므로 빈 강의가
쌓이지 않는다.

### 3. 이 응답은 안내이고 게이트가 아니다

**조회에 실패하면 잠그지 않는다.** 진짜 차단은 서버가 계속 503으로 한다. 조회 실패를 잠금으로 바꾸면
멀쩡한 환경에서 업로드만 못 하게 될 뿐이다 — 클라이언트가 게이트 역할을 하려 들면 그 클라이언트의
장애가 곧 기능 장애가 된다.

버튼을 잠근 것과 별개로 제출 핸들러도 잠금을 본다. 버튼이 `disabled`여도 Enter로 폼은 제출된다.

## 결과

- 강사는 **폼을 채우기 전에** 왜 막혔는지 안다.
- 실패할 업로드가 만들던 **빈 강의 행이 더 이상 생기지 않는다.**
- 스위치를 열면(`RECORDED_STT_ENABLED=true` + `recorded-stt-worker` 배포) 화면은 그대로 열린다 —
  화면에 상태를 하드코딩하지 않았다.
- 서버 게이트는 그대로다. 화면을 우회해도 티켓은 발급되지 않는다.

## 검증

| 무엇 | 어디 |
|---|---|
| 스위치가 닫히면 `capabilities`가 그렇게 답한다 + 미인증 401 | `RecordedSttRequiredContractTest` |
| 스위치가 열리면 둘 다 `true` | `RecordedLessonUploadContractTest` |
| 닫히면 화면이 이유를 알리고 제출을 잠근다(제목·영상을 채워도) | `CurriculumWorkspace.test.tsx` |
| 스위치를 **못 읽으면** 막지 않는다 | `CurriculumWorkspace.test.tsx` |

FE 두 건은 고침을 제거해 각각 실패하는 것을 확인했다(제출 잠금 제거 → `toBeDisabled` 실패,
fail-closed로 뒤집기 → `toBeEnabled` 실패). BE는 `capabilities()`가 `sttEnabled`를 무시하도록
바꿔 실패를 확인했다.

## 남은 것

- **운영에서 스위치를 열 것인가**는 비용 판단이라 이 ADR의 범위 밖이다. 열기로 하면
  `recorded-stt-worker` 배포와 `RECORDED_STT_ENABLED=true`가 함께 필요하다.
- 이미 만들어진 **빈 `AWAITING_UPLOAD` 강의**는 이 변경이 지우지 않는다. 새로 생기는 것만 막는다.
