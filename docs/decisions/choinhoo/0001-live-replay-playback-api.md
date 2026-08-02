# ADR-0001: 라이브 되감기와 종료 후 다시보기 재생 API 통합

> 관련 결정: [ADR-0032 학생 HLS 단일 재생](../songjeongki/0032-media-playback-hls-only.md) ·
> [ADR-0034 Egress 완료 webhook](../songjeongki/0034-egress-completion-webhook.md) ·
> [ADR-0039 다시보기 재생 API](../songjeongki/0039-replay-playback-api.md) ·
> [ADR-0002 라이브 시작 publisher·STT 서비스·Egress 게이트](0002-live-start-egress-stt-orchestration.md) ·
> [ADR-0005 학생 HLS·자막 drain](0005-ended-hls-caption-drain.md) ·
> [ADR-0007 녹화 READY 자동 게시·processing 폴링](0007-recording-ready-auto-publish-and-processing-polling.md)

- **상태**: 채택 — `ENDED` classroom 연속 시청 정책은 ADR-0005, 새 녹화의 자동 게시 정책은
  ADR-0007로 개정
- **일자**: 2026-07-27

> 2026-07-28에 `recent`/`dvr` 두 source 설계를 폐기하고 `index.m3u8` 기반 단일 `source`로
> 구현했다. 과거 설계와 폐기된 파라미터·오류코드는 본문에서 제거한다.

## 맥락

ADR-0039 구현은 종료된 `READY` VOD만 대상으로 했다. ADR-0032가 확정한 학생 HLS 단일 재생에서는
같은 Egress 산출물을 라이브 시청·되감기·종료 후 VOD에 사용해야 한다. 기존 구현은 `READY` 전
자산을 모두 차단했고, Blob에 담긴 인라인 manifest는 지속 갱신되는 라이브 playlist polling에도
맞지 않았다.

로컬 선행 구현(`a97c78b`)은 `recent`/`dvr`와 별도 manifest 엔드포인트를 도입했지만,
라이브 접근을 위해 `ReplayStatus` 기본값을 `PUBLISHED`로 바꿔 종료 후 검수 게시 흐름까지
우회했다. 또한 metadata 조회에서도 세그먼트를 전부 presign하고 결과를 버리며,
`EXT-X-MAP`·`EXT-X-KEY` 내부 URI와 상대경로 정규화가 ADR-0039 구현보다 약했다.

## 결정

### 1. 라이브 접근과 VOD 게시 상태를 분리한다

- `ReplayStatus` 기본값은 `DRAFT`를 유지한다.
- 소유 강사는 라이브 중과 종료 후 모두 자기 녹화를 볼 수 있다.
- 학생은 활성 수강 및 `lesson.status=PUBLISHED` 조건을 항상 만족해야 한다.
- `STARTING`·`LIVE`·`ENDING` 세션에서는 학생도 `ReplayStatus`와 무관하게 metadata를 조회할 수 있다.
  단, [ADR-0002](0002-live-start-egress-stt-orchestration.md)가 이 결정을 좁혀 `STARTING`에는
  `source=null`과 준비 상태만 제공하고 실제 HLS·누적 DVR은 원자적 `LIVE` 전환 뒤부터 공개한다.
- `ENDED` 세션에 **새로 다시보기로 진입**할 때는 학생에게 `VideoAssetStatus.READY`이면서
  `ReplayStatus.PUBLISHED`인 자산만 공개한다.
- 이미 라이브 classroom에서 시청 중인 학생은 ADR-0005에 따라 `FINALIZING`·`VERIFYING` 동안에도
  같은 HLS를 계속 받고 마지막 버퍼까지 소비한다. 이 연속 시청 grant는 다시보기 게시 권한과 분리한다.
  현재 lesson 기반 endpoint는 두 접근 맥락을 구분하지 못하므로 코드 반영이 필요하다.
- 새 정상 녹화는 ADR-0007에 따라 성공 webhook에서 `READY + PUBLISHED`로 자동 게시한다. 기존
  `READY + DRAFT/READY_FOR_REVIEW`와 철회 후 재게시는 `POST .../replay-review/publish`를 유지하고,
  공개 중단은 `POST .../replay-review/withdraw`를 사용한다. 라이브 진행 중 철회는 409로 거부한다.

### 2. 재생 API를 metadata와 manifest 두 단계로 나눈다

- `GET /api/lessons/{lessonId}/playback`
  - 세션·시간축·단일 `source` metadata를 JSON으로 반환한다.
  - manifest가 아직 없으면 `source=null`로 내려 초기 Egress 지연을 정상 상태로 표현한다.
  - metadata 계산은 raw manifest의 PDT·EXTINF만 파싱하며 presign 결과를 만들지 않는다.
- `GET /api/lessons/{lessonId}/playback/manifest`
  - same-origin 세션 쿠키로 권한을 다시 검증한다.
  - `application/vnd.apple.mpegurl`, `Cache-Control: no-store`로 재작성 manifest를 반환한다.
  - 라이브 중 아직 생성되지 않은 manifest는 409 `RECORDING_STARTING`이다.
  - 종료된 READY 자산의 manifest가 사라졌으면 409 `REPLAY_NOT_READY`다.

manifest URL은 백엔드의 안정적인 URL이므로 응답에 만료시각을 싣지 않는다. manifest 안의
세그먼트 presigned URL만 `video.playback.segment-url-ttl`(현재 기본 6시간) 후 만료된다.
세그먼트 403 또는 장시간 일시정지 뒤에는 FE가 manifest URL을 다시 로드한다.

라이브 중 `index.m3u8`은 ENDLIST 없이 자라는 EVENT 목록이므로 라이브 엣지와 세션 처음까지의
seek을 한 source로 제공한다.

### 3. master의 권한 SPI와 manifest 견고성을 유지한다

- 레슨→섹션→커리큘럼 소유·수강 판정은 `video.api.LessonPlaybackAccess`를 curriculum이
  구현하는 현재 모듈 경계를 유지한다. `LiveSessionView`에 `curriculumId`를 추가하지 않는다.
- manifest 일반 URI와 `EXT-X-MAP`·`EXT-X-KEY`의 `URI` 속성을 모두 presign한다.
- manifest 디렉터리 기준 `./`·중복 구분자를 정규화하고, `..`로 디렉터리 밖 객체를
  서명하려는 URI는 거부한다.
- 첫 `EXT-X-PROGRAM-DATE-TIME`과 `live_session.started_at` 차이를 요청 시 계산한다.
  `video_asset.session_offset_ms`에는 쓰지 않는다.

### 4. 저장소 포트를 분리하고 DB 트랜잭션 밖에서 미디어 I/O를 수행한다

- webhook 존재 검증은 `RecordingStorage`, 재생 읽기·presign은 `ReplayStorage`가 계속 소유한다.
- `S3RecordingStorage` 하나가 같은 MinIO 설정으로 두 포트를 구현한다.
- 재생 metadata/manifest 처리 동안 DB read transaction을 열린 채로 MinIO GET과 세그먼트
  presign을 수행하지 않는다.
- 녹화 시작 시 `hlsManifestKey`를 저장하고, 쓰기·읽기가 `RecordingObjectKeys` 규약을 공유한다.

## MVP 범위

### MVP 필수

- 권한에 맞는 metadata와 인증 manifest 제공
- 라이브 중 단일 HLS source 재생과 종료 후 같은 녹화물 재생
- 새 다시보기 진입은 종료 후 `READY + PUBLISHED`일 때만 접근
- 기존 classroom은 `ENDED` 뒤에도 `FINALIZING/VERIFYING → READY` HLS를 연속 재생
- manifest의 일반 URI와 `EXT-X-MAP`·`EXT-X-KEY` URI를 안전하게 presign
- PDT·EXTINF 기반 시간축과 재생 가능 범위 계산

URI 경로 이탈 차단, 접근 권한 재검증, presigned URL은 운영 편의 기능이 아니라 녹화물 접근 제어의
필수 경계이므로 MVP에서도 유지한다.

### 현재 구현됐지만 MVP 완료 조건은 아님

- HLS 델타 재생목록(`CAN-SKIP-UNTIL`, `_HLS_skip`, `EXT-X-SKIP`)
- 장시간 라이브를 고려한 세그먼트 URL 기본 TTL 6시간

둘은 긴 재생목록의 전송량과 장시간 되감기 실패를 줄이는 최적화다. 현재 코드와 계약에는 반영돼
있지만, 기본 재생·되감기·VOD 공개가 동작하는지를 판단하는 MVP 완료 조건으로 사용하지 않는다.
단순화하려면 코드·FE 동작·`CONTRACT.md`를 함께 바꾸는 별도 변경으로 진행한다.

### 추후 고려

- 실제 장시간 강의에서 manifest 크기와 갱신 비용을 계측한 뒤 델타 재생목록 유지 여부 결정
- manifest 재작성 캐시
- 실제 Egress 산출물의 태그 구성과 장시간 재생 E2E 검증

## API 오류 계약

| HTTP | code | 조건 |
|---|---|---|
| 403 | `ENROLLMENT_REQUIRED` | 소유 강사도 활성 수강생도 아님 |
| 403 | `REPLAY_FORBIDDEN` | 비소유 강사의 게시·철회 |
| 404 | `LESSON_NOT_FOUND` | 레슨 부재 또는 학생에게 미게시 레슨 은닉 |
| 404 | `REPLAY_NOT_FOUND` | 자산 부재 또는 종료 후 미게시 다시보기 은닉 |
| 409 | `RECORDING_STARTING` | 라이브 Egress manifest 생성 지연 |
| 409 | `REPLAY_NOT_READY` | 종료 자산 미완료·실패·manifest 유실 |
| 409 | `REPLAY_PUBLISH_CONFLICT` | READY 전 게시 |
| 409 | `REPLAY_WITHDRAW_WHILE_LIVE` | 라이브 중 철회 |
| 503 | `PLAYBACK_STORAGE_UNAVAILABLE` | MinIO 읽기·presign 실패 |

## 영향

- ADR-0039의 권한 SPI·presigned 세그먼트·PDT 온디맨드 계산은 유지한다. 최초 수동 게시 기본 정책은
  ADR-0007이 새 정상 녹화에 한해 자동 게시로 대체하며, 수동 게시 API는 기존·철회 자산에 유지한다.
- ADR-0039의 `READY` 전면 게이트와 인라인 manifest 응답은 이 ADR이 대체한다.
- DB 마이그레이션은 없다. 기존 `hls_manifest_key`·게시·철회 컬럼을 사용한다.
- API JSON·상태코드가 바뀌므로 BE 계약 테스트와 FE HTTP 계약을 같은 변경에서 갱신한다.
