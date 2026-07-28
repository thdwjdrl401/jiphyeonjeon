# ADR-0001: 라이브 되감기와 종료 후 다시보기 재생 API 통합

> 관련 결정: [ADR-0032 학생 HLS 단일 재생](../songjeongki/0032-media-playback-hls-only.md) ·
> [ADR-0034 Egress 완료 webhook](../songjeongki/0034-egress-completion-webhook.md) ·
> [ADR-0039 다시보기 재생 API](../songjeongki/0039-replay-playback-api.md)

- **상태**: 채택 (2026-07-28 §2 개정 — 아래 참조)
- **일자**: 2026-07-27

> ### 2026-07-28 개정 — `recent`/`dvr` 두 source → 단일 source + 델타 재생목록
>
> §2의 `sources.recent`/`sources.dvr` 분리를 **`source` 하나로 대체**한다. 응답 필드는
> `sources:{recent,dvr}` → `source`, manifest 엔드포인트의 `?source=` 파라미터는 제거,
> 오류코드 `PLAYBACK_SOURCE_INVALID`도 함께 사라진다.
>
> **왜**: `recent`(LiveKit `live.m3u8`)로는 되감기 요구를 만족할 수 없다. 슬라이딩 윈도우라
> 세션 처음으로 돌아갈 수 없고, 윈도우 길이는 LiveKit egress API에 설정 필드 자체가 없어
> (`SegmentedFileOutput`은 `playlist_name`·`live_playlist_name`·`segment_duration`만 받는다)
> 우리가 정할 수도 없다. 반면 `index.m3u8`은 라이브 중 ENDLIST 없이 자라는 EVENT 목록이라
> **라이브 엣지 추종과 세션 처음까지의 seek을 한 목록이 동시에** 준다.
>
> **그럼 크기는**: §2가 두 source를 둔 실질적 이유는 라이브 중 재생목록이 계속 자라는 문제였다.
> 이건 자르는 게 아니라 **HLS 델타 재생목록**(RFC 8216bis §6.2.5.1)으로 푼다. 잘라 보내면
> 플레이어는 "나머지는 사라졌다"로 읽어 진행 바가 쪼그라들지만, `#EXT-X-SKIP`은 "생략했으니
> 갖고 있는 것과 병합하라"는 신호라 진행 바가 강의 전체로 유지된다. 그래서
> `EXT-X-MEDIA-SEQUENCE`도 건드리지 않는다.
>
> 서버는 라이브 재생목록에 `#EXT-X-SERVER-CONTROL:CAN-SKIP-UNTIL=<n>`을 실어 능력을 광고하고,
> 플레이어가 `_HLS_skip=YES`를 붙여 오면 경계 밖 세그먼트를 생략한 본문을 준다. 클라이언트별
> 상태를 서버가 들지 않는다. `hls.js` 1.6.16이 기본 설정으로 이 협상을 수행하는 것을 확인했다
> (`getSkipValue` → `_HLS_skip`, `SKIPPED-SEGMENTS` 병합, `deltaUpdateFailed` 시 전체 재요청 폴백).
>
> **딸린 변경**: 델타는 옛 세그먼트의 presigned URL을 다시 주지 않으므로
> `video.playback.segment-url-ttl` 기본값을 1h → **6h**로 올린다. 그러지 않으면 오래 시청한
> 학생이 앞으로 되감을 때 403을 맞는다.
>
> **미검증**: 실제 Egress 출력으로 e2e 확인하지 않았다. LiveKit이 라이브 중 내는 `index.m3u8`의
> 실제 태그 구성(`EXT-X-VERSION` 값, PDT 주기)은 배포 후 확인이 필요하다.

## 맥락

ADR-0039 구현은 종료된 `READY` VOD의 `index.m3u8`을 인라인 JSON으로 반환한다. 반면
ADR-0032가 확정한 학생 HLS 단일 재생은 라이브 중 `live.m3u8` 엣지 재생과
`index.m3u8` 되감기를 같은 플레이어에서 이어야 한다. 기존 구현은 `READY` 전 자산을 모두
차단하므로 라이브 시청 원천으로 사용할 수 없고, Blob에 담긴 인라인 manifest는 지속 갱신되는
라이브 playlist polling에도 맞지 않는다.

로컬 선행 구현(`a97c78b`)은 `recent`/`dvr`와 별도 manifest 엔드포인트를 도입했지만,
라이브 접근을 위해 `ReplayStatus` 기본값을 `PUBLISHED`로 바꿔 종료 후 검수 게시 흐름까지
우회했다. 또한 metadata 조회에서도 세그먼트를 전부 presign하고 결과를 버리며,
`EXT-X-MAP`·`EXT-X-KEY` 내부 URI와 상대경로 정규화가 ADR-0039 구현보다 약했다.

## 결정

### 1. 라이브 접근과 VOD 게시 상태를 분리한다

- `ReplayStatus` 기본값은 `DRAFT`를 유지한다.
- 소유 강사는 라이브 중과 종료 후 모두 자기 녹화를 볼 수 있다.
- 학생은 활성 수강 및 `lesson.status=PUBLISHED` 조건을 항상 만족해야 한다.
- `STARTING`·`LIVE`·`ENDING` 세션에서는 학생도 `ReplayStatus`와 무관하게 현재 HLS와
  누적 DVR을 볼 수 있다.
- `ENDED` 세션에서는 학생에게 `VideoAssetStatus.READY`이면서
  `ReplayStatus.PUBLISHED`인 자산만 공개한다.
- 게시 전환은 기존 `POST .../replay-review/publish`를 유지하고, 같은 경로 계열에
  `POST .../replay-review/withdraw`를 추가한다. 라이브 진행 중 철회는 409로 거부한다.

### 2. 재생 API를 metadata와 manifest 두 단계로 나눈다

> ⚠️ **아래 §2의 두 source(`recent`/`dvr`) 부분은 2026-07-28 개정으로 대체됐다**(문서 상단 참조).
> 두 단계로 나누는 결정 자체는 유효하다. 지금 구현은 `source` 하나 + 델타 재생목록이다.

- `GET /api/lessons/{lessonId}/playback`
  - 세션·시간축·`sources.recent`/`sources.dvr` metadata를 JSON으로 반환한다.
  - manifest가 아직 없는 라이브 source는 `null`로 내려 초기 Egress 지연을 정상 상태로 표현한다.
  - metadata 계산은 raw manifest의 PDT·EXTINF만 파싱하며 presign 결과를 만들지 않는다.
- `GET /api/lessons/{lessonId}/playback/manifest?source=recent|dvr`
  - same-origin 세션 쿠키로 권한을 다시 검증한다.
  - `application/vnd.apple.mpegurl`, `Cache-Control: no-store`로 재작성 manifest를 반환한다.
  - 라이브 중 아직 생성되지 않은 source는 409 `RECORDING_STARTING`이다.
  - 종료된 READY 자산의 DVR manifest가 사라졌으면 409 `REPLAY_NOT_READY`다.

manifest URL은 백엔드의 안정적인 URL이므로 응답에 만료시각을 싣지 않는다. manifest 안의
세그먼트 presigned URL만 `video.playback.segment-url-ttl`(기본 1시간) 후 만료된다.
세그먼트 403 또는 장시간 일시정지 뒤에는 FE가 manifest URL을 다시 로드한다.

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

## API 오류 계약

| HTTP | code | 조건 |
|---|---|---|
| ~~400~~ | ~~`PLAYBACK_SOURCE_INVALID`~~ | **2026-07-28 폐기** — source 파라미터가 없어졌다 |
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

- ADR-0039의 권한 SPI·presigned 세그먼트·PDT 온디맨드 계산·검수 게시 결정은 유지한다.
- ADR-0039의 `READY` 전면 게이트와 인라인 manifest 응답은 이 ADR이 대체한다.
- DB 마이그레이션은 없다. 기존 `hls_manifest_key`·게시·철회 컬럼을 사용한다.
- API JSON·상태코드가 바뀌므로 BE 계약 테스트와 FE HTTP 계약을 같은 변경에서 갱신한다.
- manifest 재작성 캐시는 데모 규모에서 도입하지 않는다. 장시간 강의 부하는 후속 계측으로 남긴다.
