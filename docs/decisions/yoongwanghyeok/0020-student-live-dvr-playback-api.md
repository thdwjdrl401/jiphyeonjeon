# ADR-0020: 학생 라이브 재생은 세션별 HLS DVR URL 계약으로 제공

> 📍 공유 계약: [../../CONTRACT.md](../../CONTRACT.md) · 관련 결정: [0032](../songjeongki/0032-media-playback-hls-only.md) · [0039](../songjeongki/0039-replay-playback-api.md)

- **상태**: 채택
- **일자**: 2026-07-27
- **관련**: 학생 HLS 단일 재생, LiveKit Egress `live.m3u8`, 세션 시계 자막·북마크 정렬

## 맥락

학생은 LiveKit 룸을 직접 구독하지 않고 강사의 LiveKit 송출을 Egress가 만든 HLS로 시청한다. 기존 결정은 학생 재생을 HLS 단일로 확정했지만, 라이브 재생 API·세션별 URL·권한·오류·DVR 범위는 구현 가능한 계약으로 고정하지 않았다. FE가 환경변수로 미디어 주소를 조립하거나 HTTP 실패 시 샘플 스트림으로 대체하면 세션 격리와 운영 장애가 가려진다.

또한 “라이브 엣지”만 명시하면 학생이 이미 지나간 구간을 돌려보고 자막·북마크를 같은 세션 시계로 맞추는 제품 요구를 충족하지 못한다. 라이브와 다시보기를 같은 HLS 플레이어로 잇는 ADR-0032의 취지를 실제 API로 확정해야 한다.

## 결정

1. 학생 라이브 재생 메타데이터는 `GET /api/live-sessions/{sessionId}/playback`으로 조회한다. 경로의 `sessionId`와 응답의 `sessionId`는 같아야 하며 각 세션은 자기 Egress 산출물만 반환한다.
2. 응답은 `{sessionId, playbackUrl, mimeType, streamType, sessionOffsetMs}`의 camelCase DTO다. `streamType`은 `LIVE_DVR`, `mimeType`은 `application/vnd.apple.mpegurl`이다. `playbackUrl`은 FE가 내부 구조를 해석하지 않는 opaque URL이다.
3. 실제 HTTP 모드는 이 API만 사용한다. 주소 부재·잘못된 DTO·API 실패를 샘플로 대체하지 않는다. Mock 모드만 화면 검증용 공개 HLS 샘플을 같은 Interface로 반환한다.
4. 라이브 매니페스트는 세션 시작부터 현재 라이브 엣지까지 seek 가능해야 하며 라이브 중 `#EXT-X-ENDLIST`를 포함하지 않는다. Egress의 `live.m3u8`이 짧은 슬라이딩 목록이라면 백엔드가 이미 저장된 세그먼트를 이용해 세션 전체 DVR 매니페스트를 구성한다.
5. `sessionOffsetMs`는 첫 PDT와 `live_session.started_at`의 차이다. FE는 `currentTime * 1000 + (sessionOffsetMs ?? 0)`을 자막·북마크의 `sessionMs`로 사용한다.
6. 인증은 기존 HttpOnly 쿠키 세션을 사용한다. 활성 수강생과 소유 강사만 허용하고, 주소가 가리키는 매니페스트와 세그먼트까지 동일한 권한 경계를 유지한다.
7. 라이브 종료 후에는 기존 `GET /api/lessons/{lessonId}/playback`의 VOD `index.m3u8` 계약으로 전환한다. 라이브 API는 종료 상태를 409 `LIVE_ENDED`로 알린다.

## 근거

- **세션별 서버 발급 URL**: 클라이언트가 스토리지 경로를 추측하지 않으므로 저장 규약 변경과 세션 간 경로 혼동을 막는다.
- **HTTP 실패 시 fallback 금지**: 운영 장애를 성공처럼 보이지 않게 하고 백엔드 계약 누락을 즉시 드러낸다.
- **세션 전체 DVR**: 학생이 이전 구간을 돌려볼 수 있고, 같은 `sessionMs` 축으로 자막·북마크를 맞출 수 있다.
- **opaque URL**: 백엔드는 same-origin manifest 프록시와 presigned 미디어 URL 중 인프라에 맞는 구현을 선택할 수 있고 FE 계약은 유지된다.

## 대안

| 대안 | 장점 | 단점 |
|---|---|---|
| **세션별 메타데이터 API + 전체 DVR (선택)** | 세션 격리, 오류 가시성, 돌려보기·시간축 정렬 | 백엔드가 라이브 manifest와 세그먼트 권한을 제공해야 함 |
| FE 환경변수 URL 템플릿 | 백엔드 구현이 작아 보임 | 저장 경로가 FE에 누출되고 세션 권한·주소 갱신 책임이 분산됨 |
| 실제 API 실패 시 샘플 HLS fallback | 개발 화면이 항상 재생됨 | 운영 장애를 숨기고 실제 세션이 아닌 영상을 보여줌 |
| 라이브 엣지만 제공 | manifest가 단순함 | 돌려보기와 자막·북마크 시간축 요구를 충족하지 못함 |

## 영향·후속

- FE `live-session` feature의 Interface·Mock·HTTP·facade에 `getLivePlayback(sessionId)`를 추가한다.
- Vidstack은 `live:dvr` 모드를 사용하고 HLS 시각에 `sessionOffsetMs`를 더한다.
- 백엔드는 §2-1 DTO·권한·오류 계약, 라이브 manifest 제공 경로, 전체 DVR 세그먼트 보존·재작성을 구현해야 한다.
- 백엔드 계약 테스트는 세션 A 요청이 세션 B URL을 반환하지 않는지, 미수강·미시작·매니페스트 미준비·종료·업스트림 실패를 각각 검증해야 한다.
- 실제 EC2 LiveKit Egress 산출물로 세션 시작부터 라이브 엣지까지 seek, manifest 갱신, 종료 후 VOD 전환을 통합 검증해야 한다.
