# ADR-0039: 다시보기 재생 API — presigned manifest 인라인, PDT 앵커 온디맨드 계산, 게시 최소형

> 📍 하네스 개요: [../../harness/README.md](../../harness/README.md) · 아키텍처: [../../ARCHITECTURE.md](../../ARCHITECTURE.md) · 계약: [../../CONTRACT.md](../../CONTRACT.md)

- **상태**: 채택
- **일자**: 2026-07-26
- **관련**: [0032](0032-media-playback-hls-only.md)(HLS 단일 재생), [0034](0034-egress-completion-webhook.md)(egress webhook·VERIFYING), [0020](0020-egress-recording-lifecycle.md)(녹화 생명주기), [0033](0033-learning-progress-wiring.md)(학습 접근 SPI 패턴) · ARCHITECTURE §9-8·§9-9, Jira liveclass-100

## 맥락

[ARCHITECTURE §9-8](../../ARCHITECTURE.md)은 재생 인증을 presigned 방식으로 통일할 것을 제안만 해 뒀고(`GET /api/lessons/{id}/playback`이 권한 검증 + manifest presigned 재작성), §9-9는 시간축 변환 규칙(첫 PDT를 앵커로 오프셋 하나)을 확정만 해 뒀다. 실제 엔드포인트·서비스는 존재하지 않았다 — `ReplayView`가 `durationMs`만 내려주고, `video_asset.hls_manifest_key`·`session_offset_ms` 컬럼은 있지만 아무도 채우지 않았다.

FE(`httpReplayService.ts`)는 검수 저장(`PUT .../replay-review`)·게시(`POST .../replay-review/publish`)를 이미 501 경로로 박아 뒀다. 이 작업은 그중 **재생 조회 + 게시 전환만** 구현한다(검수 저장은 아래 범위 참고).

## 결정

### 1. 권한 게이트 — `LessonPlaybackAccess` SPI, learning과 다른 판정

`learning.api.LessonLearningAccess`와 같은 방향으로 `video.api.LessonPlaybackAccess`를 선언하고 curriculum(`LessonPlaybackAccessImpl`)이 구현한다(레슨→섹션→커리큘럼→소유·수강 관계는 curriculum 지식, video가 curriculum을 직접 참조하면 순환).

다만 판정 자체가 학습과 다르다 — **학습은 소유 강사도 미수강이면 막지만, 재생은 소유 강사를 검수 목적으로 항상 통과시킨다.** `resolve(userId, lessonId)`는 소유 강사면 `owner=true`, 활성 수강생이면 `owner=false`를 돌려주고, 둘 다 아니면 `PlaybackAccessException`(NOT_FOUND/ENROLLMENT_REQUIRED)을 던진다. 게시 상태(PUBLISHED)·자산 READY 게이트는 이 SPI 밖, video 서비스가 적용한다:

- 레슨 없음 → 404 `LESSON_NOT_FOUND`(존재 은닉, 목차 규칙과 동일)
- 소유도 활성 수강도 아님 → 403 `ENROLLMENT_REQUIRED`(learning의 코드와 같은 값 — FE가 같은 수강 유도 분기로 처리)
- 자산 자체가 없음, 또는 **학생인데 미게시(DRAFT/READY_FOR_REVIEW/WITHDRAWN)** → 404 `REPLAY_NOT_FOUND`(미게시 다시보기의 존재를 학생에게 드러내지 않는다 — 소유 강사는 이 게이트를 안 받는다)
- 자산이 READY가 아님(RECORDING/FINALIZING/VERIFYING/FAILED) → 409 `REPLAY_NOT_READY`(존재는 하지만 지금은 재생 불가라 부재(404)가 아니라 상태 충돌)

게시(`POST /instructor/lessons/{id}/replay-review/publish`)는 소유 강사 전용이라 "미수강" 개념이 없다 — `resolve()`가 무엇을 이유로 실패하든(레슨 없음·비소유 등) **소유자가 아니라는 뜻**이므로 전부 403 `REPLAY_FORBIDDEN`으로 통일한다(다른 강사의 커리큘럼을 건드릴 때 쓰는 `CURRICULUM_FORBIDDEN` 계열과 같은 관례).

### 2. Manifest 재작성 — 인라인 응답, 별도 GET 없음

`GET /api/lessons/{id}/playback` 응답에 재작성된 매니페스트 텍스트를 **JSON 필드로 인라인** 포함한다(별도 `GET .../manifest` 엔드포인트로 쪼개지 않는다).

```json
{ "manifest": "#EXTM3U\n...\nhttps://minio/...&X-Amz-Signature=...\n#EXT-X-ENDLIST\n",
  "sessionOffsetMs": 1234,
  "durationMs": 600000 }
```

FE는 이 문자열을 `Blob`(`type: application/vnd.apple.mpegurl`)로 감싸 object URL을 만들고 hls.js에 물린다(`hls.loadSource(blobUrl)`) — hls.js는 URL이든 텍스트든 상관없이 파싱하므로 인라인이 문제없다.

재작성 자체는 `#`로 시작하는 태그·빈 줄은 그대로 두고, 절대 URL(`http`/`https`, 이미 서명됐거나 외부)이 아닌 상대 세그먼트 URI(`seg_00000.ts`)만 스토리지 키(`sessions/{id}/seg_00000.ts`)로 환산해 `ReplayStorage.presignSegment`로 presigned GET URL로 바꾼다. 세그먼트 바이트는 앱 서버를 통과하지 않는다(원칙 4) — 서버는 수 KB짜리 매니페스트 텍스트만 만진다.

**견고성(2026-07-26 리뷰 반영)**:
- 상대 URI는 재작성 전에 정규화한다 — 선행 `./` 제거, 연속 `//` 축약 후 매니페스트 디렉토리 프리픽스와 결합. Egress 실제 출력은 `seg_00000.ts` 그대로지만 다른 패키저·수동 편집 매니페스트의 `./seg_00000.ts` 형태를 방어한다.
- **태그 내부 URI도 재작성한다.** `#EXT-X-MAP:URI="..."`(fMP4 초기화 세그먼트)·`#EXT-X-KEY:URI="..."`(암호화 키)는 세그먼트 줄이 아니라 태그 속성이라 단순 "비-`#` 줄만 재작성" 규칙에 걸리지 않는다 — 지금 Egress 설정(TS, 비암호화)에선 안 나오지만, 나중에 fMP4·암호화로 바뀌면 이 재작성이 없으면 초기화 세그먼트나 키 요청이 presign 없이 나가 **조용히 재생이 깨진다.** 그래서 처음부터 태그 속성값도 같은 정규화·presign 경로를 태운다.
- 절대 URL(`http://`·`https://`)은 이미 서명됐거나 외부 자원이라 애초에 재작성이 불가능하다 — 그대로 두되 WARN 로그를 남겨, 만약 매니페스트에 예상 밖의 절대 URL이 섞여 있으면(설정 실수 등) 운영 로그로 드러나게 한다.
- **미검증 갭**: 이 환경엔 실제 egress `index.m3u8`(EC2 실녹화 산출물)로 검증할 수단이 없다 — 로컬은 목 매니페스트로만 확인했다. 위 정규화·태그 재작성으로 알려진 변형은 방어했지만, **EC2에서 실제 라이브 녹화를 한 번 돌려 만들어진 index.m3u8을 이 서비스에 통과시켜 확인하는 후속 검증이 필요**하다(비블로커 — 정규화로 방어됨).

### 3. 시간축 앵커 — 온디맨드 계산, 저장하지 않음

§9-9는 "webhook 수신기가 index.m3u8 첫 PDT를 파싱해 `session_offset_ms`에 저장"을 선행 작업으로 적어 뒀다. 이 작업은 **그 대신 재생 요청 시점에 매번 계산**한다 — 어차피 매니페스트를 읽어 세그먼트를 재작성하는 김에 같은 텍스트에서 첫 `#EXT-X-PROGRAM-DATE-TIME`을 파싱하고, `live_session.started_at`(video가 이미 의존하는 `LiveSessionDirectory`로 조회)과의 차이를 ms로 계산해 응답에 실어 보낸다. `video_asset.session_offset_ms` 컬럼에는 **쓰지 않는다** — 값을 두 곳(webhook·재생)에서 따로 계산하게 만들면 드리프트 위험만 생기고, 재생 요청마다 다시 계산해도 비용은 문자열 파싱 한 번뿐이다.

PDT가 없거나(옵션 끄면 안 나오지만 Egress는 항상 넣는다, §9-9 조사 결과) `live_session.started_at`을 못 구하면 `sessionOffsetMs: null`로 degrade한다 — 에러가 아니다. FE는 null이면 자막 정렬 보정을 생략한다.

> `video_asset.recording_started_at`을 앵커로 쓰면 안 된다는 §9-9의 경고는 여기서도 유효하다 — 이 구현은 `recording_started_at`을 전혀 참조하지 않고 `live_session.started_at`만 쓴다.

### 3-1. 자산 READY인데 매니페스트 부재 → 409(500 방지)

`video_asset.status == READY`는 webhook VERIFYING 시점(1회)에 매니페스트 존재를 확인했다는 뜻일 뿐, **그 이후에도 계속 존재를 보장하지 않는다** — `video_asset.retention_until` 만료로 보존 기간이 지난 녹화본이 스토리지에서 먼저 정리되는 경우가 실제 엣지케이스다(자산 행은 남아 있는데 파일만 없어짐). `S3RecordingStorage.readManifest`가 이 상황에서 그대로 `NoSuchKeyException`/`S3Exception(404)`을 던지면 처리되지 않은 예외가 컨트롤러까지 올라가 500이 된다.

→ `readManifest`가 404를 `ReplayManifestMissingException`(video-service 내부, `ReplayStorage` 포트에 선언)으로 감싸 던지고, `ReplayPlaybackService.playback`이 이를 잡아 409 `REPLAY_NOT_READY`로 옮긴다 — 자산 미준비와 같은 코드다. 학생·강사 모두 "지금은 못 본다"는 같은 신호를 받고, FE는 이미 그 코드를 재시도 유도로 처리하도록 돼 있어 추가 분기가 필요 없다.

### 3-2. TTL 만료와 재요청

`playbackUrlTtlSeconds`(기본 3600초 = 1시간)가 지나면 매니페스트 안의 presigned 세그먼트 URL이 만료돼 스토리지가 403을 준다. **서버는 만료를 감지하거나 밀어주지 않는다** — HLS는 클라이언트 pull 모델이라 서버가 능동적으로 알릴 방법이 없다. 대신 FE 계약을 다음으로 명시한다: **세그먼트 GET이 403을 받으면 FE는 `GET /lessons/{id}/playback`을 다시 호출해 매니페스트(와 그 안의 새 presigned URL)를 갱신한다.** hls.js는 매니페스트 재로드를 지원하므로 이 재호출 후 `loadSource`를 다시 부르면 된다.

TTL과 녹화 길이의 관계: 기본 1시간 TTL은 일반적인 강의(수십 분~1~2시간) 시청 중 만료가 거의 발생하지 않게 잡은 값이다. 다만 **재생을 일시정지한 채 1시간 넘게 방치**하거나 **TTL보다 긴 녹화**(예: 장시간 세미나)에서 뒷부분 세그먼트에 도달하는 시점엔 만료가 발생할 수 있다 — 위 재호출 계약이 그 경우의 유일한 복구 경로다. TTL을 늘리는 대신 재호출 계약을 택한 이유는, presigned URL의 노출 시간을 필요 이상으로 늘리지 않기 위해서다.

### 4. `hls_manifest_key` — 저장된 값 우선, 없으면 규약으로 파생

`RecordingService.startRecording`이 아직 `video_asset.hls_manifest_key`를 채우지 않는다(이 작업 범위 밖). 재생 서비스는 컬럼 값이 있으면 그것을, 없으면 `RecordingService`와 공유하는 규약(`sessions/{liveSessionId}/index.m3u8`)으로 파생한다 — 두 값이 항상 같으므로 당장은 동작에 차이가 없고, 후속에서 `hls_manifest_key`를 실제로 채우기 시작해도(예: 매니페스트 파일명이 세션마다 달라지는 확장) 이 서비스가 자동으로 그 값을 우선한다.

### 5. 게시(publish) 최소형 — 상태 전환만, 검수 데이터 저장은 범위 밖

FE가 이미 참조하는 두 경로 중 **게시**(`POST .../replay-review/publish`)만 구현한다: 소유 강사·자산 READY 조건 하에 `replay_status`를 `PUBLISHED`로 전환하고 `published_by`·`published_at`을 채운다. 이미 PUBLISHED면 멱등(204).

**검수 데이터 저장**(`PUT .../replay-review` — 자막 교정·용어 확정 등)은 **구현하지 않는다.** 이 엔드포인트가 저장해야 할 산출물(교정 자막·확정 용어)은 CP2(STT)·CP3(용어·RAG)가 아직 없어 저장할 데이터 자체가 없다. 미리 빈 스텁을 만들면 "검수 저장이 된다"는 거짓 신호를 준다 — CP2·CP3가 자막·용어를 core에 반영하기 시작할 때 이 ADR을 대체하는 후속에서 정의한다.

## 근거

- **인라인 manifest**: 별도 `GET .../manifest`로 쪼개면 재생마다 권한 재검증을 두 번 하거나(비효율), 두 번째 호출엔 권한 컨텍스트가 없어 별도 토큰이 필요해진다(§9-8이 걷어낸 옛 PlaybackTokenService 방향으로 되돌아감). 인라인은 한 번의 인가 판정으로 재생에 필요한 모든 것을 준다.
- **PDT 앵커 저장 대신 온디맨드 계산**: webhook에 저장 로직을 얹으면 이 작업이 webhook·재생 두 파일에 걸쳐 나뉘고, 저장된 오프셋이 나중에 매니페스트가 재작성되거나(예: 재인코딩) 어긋날 경우 감지 수단이 없다. 재생 시점 계산은 항상 "지금 이 매니페스트의 실제 PDT"를 쓰므로 최신성이 보장된다. **비용 정정**: PDT 파싱 자체는 텍스트 스캔 한 번이라 무시할 수준이지만, 재생 요청당 실제 비용은 세그먼트 재작성 쪽이다 — **세그먼트 수만큼 presign 호출**(O(세그먼트 수), 2초 세그먼트 기준 30분 녹화면 약 900회)이 매 요청마다 일어난다. presign 자체는 로컬 서명 계산(네트워크 왕복 없음)이라 개별 호출은 저렴하지만, 긴 녹화·동시 재생 요청이 늘면 이 재작성 비용이 누적된다. **재작성 결과 캐싱**(TTL 내 동일 자산 재요청 시 재사용)은 이번 범위에 넣지 않고 후속 최적화로 남긴다 — 지금 트래픽 규모에선 필요성이 확인되지 않았다.
- **게시만, 검수 저장은 보류**: 자막·용어 데이터가 없는데 저장 API만 만들면 계약과 실제 동작이 어긋난다(AGENTS.md 완료 게이트 — TODO/빈 스텁 금지). 게시는 반대로 이미 있는 데이터(`video_asset` 상태)만으로 완결된 기능이라 지금 만들 수 있다.
- **REPLAY_FORBIDDEN vs ENROLLMENT_REQUIRED**: 게시는 학생 개념이 아예 없는 강사 전용 작업이라, `resolve()`의 "미수강" 실패 사유를 그대로 노출하면 FE가 잘못된 안내(수강 신청 유도)를 보여줄 위험이 있다. `InstructorCurriculumContractTest`의 비소유 강사 403(`CURRICULUM_FORBIDDEN`)과 같은 관례로 통일했다.

## 대안

| 대안 | 장점 | 단점 |
|---|---|---|
| **manifest 인라인 + PDT 온디맨드 + 게시만 (선택)** | 권한 판정 1회, 앵커 항상 최신, 검수 API 거짓 신호 없음 | 재생마다 매니페스트 재파싱(경미) |
| 별도 `GET .../manifest`(nginx류 URL) | REST스러움 | 권한 재검증 필요 또는 별도 토큰 — §9-8이 걷어낸 구조로 회귀 |
| webhook이 PDT 앵커를 `session_offset_ms`에 저장 | 재생 시 계산 생략 | webhook·재생 두 곳에 시간축 로직 분산, 드리프트 감지 수단 없음, 이 작업 범위가 webhook까지 넓어짐 |
| 검수 저장 API도 함께 스텁으로 구현 | FE 501 주석이 모두 사라짐 | 저장할 데이터가 없어 빈 스텁(AGENTS.md 완료 게이트 위반), CP2·CP3 스키마 확정 전에 API 모양을 굳히는 위험 |

## 영향·후속

- **신규 엔드포인트**: `GET /api/lessons/{id}/playback`(재생, 인증 필요), `POST /api/instructor/lessons/{id}/replay-review/publish`(게시, 강사 role + 소유 검증).
- **신규 포트**: `video.api.LessonPlaybackAccess`(SPI, curriculum 구현) · `video.service.ReplayStorage`(매니페스트 읽기·세그먼트 presign, `S3RecordingStorage`가 `RecordingStorage`와 함께 구현) · `video.service.ReplayManifestMissingException`(매니페스트 404를 409로 옮기는 내부 신호, §3-1).
- **`video_asset.hls_manifest_key`·`session_offset_ms`**: 스키마 컬럼은 유지하되 이번 작업에서 쓰지 않는다(§4 참고) — 컬럼 자체를 지우면 향후 저장 방식으로 되돌아갈 여지가 없어지므로 남겨 둔다.
- **계약 테스트**: `ReplayPlaybackContractTest`(video) — 소유 강사 검수 조회(미게시도 200), 활성 수강생 게시본 조회 200, 미수강 403 `ENROLLMENT_REQUIRED`, 학생 미게시 404 `REPLAY_NOT_FOUND`, 자산 미준비 409 `REPLAY_NOT_READY`, **자산 READY인데 매니페스트 부재 409**(§3-1), **`./seg_00000.ts` 상대 URI 정규화**, **`#EXT-X-MAP` 포함 매니페스트의 태그 내 URI 재작성**, 비소유 강사 게시 403 `REPLAY_FORBIDDEN`, 게시 전 자산 미준비 409 `REPLAY_PUBLISH_CONFLICT`, 게시 멱등. `LiveKitWebhookContractTest`와 같은 실커밋(비-`@Transactional`) 계열 — `S3RecordingStorage`를 콘크리트 타입으로 모킹해 `RecordingStorage`(webhook VERIFYING)·`ReplayStorage`(재생) 두 포트를 한 목으로 대체한다.
- **범위 밖(후속 필요)**: 검수 데이터 저장(`PUT .../replay-review`, §5), 라이브 엣지 HLS 서빙(`live.m3u8`, 이 작업은 VOD만), Egress→HLS 지연 실측([0032](0032-media-playback-hls-only.md) 후속 검증), 파이프라인 stall 탐지(§9-9의 미검증 위험), **재작성 매니페스트 캐싱**(§2 비용 정정 참고), **EC2 실녹화 매니페스트로 태그·URI 형태 실물 검증**(§2 견고성 참고, 정규화로 방어됐으나 비블로커 실측 과제로 남음).
