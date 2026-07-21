# ADR-0004: 라이브 미디어 = WebRTC 현재 시점 + Egress HLS 되감기

> 라이브 컴포넌트: [LIVE_LESSON.md](../../frontend/components/LIVE_LESSON.md) · 라이브 API: [LIVE.md](../../frontend/api/LIVE.md) · 미디어 ADR: [0004](../songjeongki/0004-media-livekit-selfhost.md), [0010](../songjeongki/0010-self-host-vod.md), [0020](../songjeongki/0020-egress-recording-lifecycle.md)

- **상태**: 제품 목표 채택, Egress DVR 실환경 검증 필요
- **일자**: 2026-07-21
- **적용 범위**: live session, LiveKit 권한, 녹화, 라이브 되감기

## 맥락

LiveKit SFU는 현재 발행되는 WebRTC 트랙을 실시간 전달하지만, 세션 시작부터 지금까지의 과거 영상을 자체적으로 임의 탐색하는 DVR 저장소는 아니다. YouTube Live처럼 현재 라이브와 과거 구간을 하나의 타임라인으로 제공하려면 녹화·세그먼트 저장과 재생 경로가 추가로 필요하다.

처음에는 “가까운 되감기는 Egress, 더 이전은 HLS”로 표현했지만 Egress와 HLS는 서로 대체하는 두 재생 기술이 아니다. **Egress는 LiveKit 미디어를 녹화하여 HLS를 생성하는 주체이고, HLS가 과거 구간 재생 형식**이다.

## 결정

1. live session은 lesson과 별도 `sessionId`·상태를 사용한다. MVP는 lesson당 session 하나로 제한한다.
2. 현재 시점은 **LiveKit WebRTC**, 과거 시점은 **Egress가 생성한 HLS**로 재생한다.
3. 라이브 시작과 함께 Egress 녹화를 시작하고 HLS 세그먼트를 MinIO에 저장한다. 같은 산출물을 종료 후 VOD에 재사용한다.
4. 프론트 내부 재생 모드는 다음처럼 분리하되 사용자에게는 하나의 타임라인으로 보여준다.
   - `RTC_LIVE`: 현재 LiveKit 트랙
   - `HLS_RECENT`: 현재에 가까운 window playlist
   - `HLS_DVR`: 세션 시작부터 누적된 전체 playlist
5. 타임라인 범위는 라이브 시작 `0ms`부터 현재 `sessionMs`까지 계속 증가한다.
6. 사용자가 과거를 선택하면 적합한 HLS source로 전환하고, 최근 window보다 이전이면 같은 `sessionMs`를 유지해 DVR source로 바꾼다.
7. 빨간 점이 있는 `LIVE` 버튼으로 HLS를 중단하고 현재 WebRTC로 복귀한다.
8. 영상·HLS·자막·채팅·질문·북마크의 공통 좌표는 **세션 시작 기준 상대 millisecond(`sessionMs`)**다.
9. 강사는 카메라·마이크·화면 공유를 publish하고, 수강생 token은 현재 **subscribe-only**다.
10. 수강생 마이크는 후속 기능으로 남긴다. 수강생 발언 요청 후 강사가 승인한 경우에만 일시 publish 권한을 발급한다.
11. 시작 전 AI·LiveKit·Egress·STT 준비 실패는 제품 목표상 시작을 차단한다. 시작 후 Egress·STT·AI 장애는 WebRTC 라이브를 유지하고 기능별 degraded 상태로 처리한다.
12. VOD는 라이브 Egress 결과로만 생성하며 별도 영상 업로드로 대체하지 않는다.

## 근거

- WebRTC는 낮은 지연의 현재 라이브에 적합하고 HLS는 저장된 과거 구간 탐색에 적합하다.
- Egress 세그먼트를 라이브 DVR과 VOD에 재사용하면 이중 녹화·변환을 피할 수 있다.
- 수강생 publish 권한을 token에서 제거하면 UI 숨김보다 강한 미디어 권한 경계를 만든다.
- 공통 `sessionMs`는 서로 다른 전송 지연과 절대 시각에 의존하지 않고 학습 데이터를 정렬한다.

## 대안

| 대안 | 장점 | 단점 |
|---|---|---|
| LiveKit만 사용 | 구성 단순 | 과거 구간 저장·탐색 불가 |
| 항상 HLS로 라이브 시청 | 단일 player | 현재 시점 지연 증가, 실시간성 저하 |
| 브라우저에서 전체 라이브 로컬 버퍼 | 서버 단순 | 새로고침·늦은 입장 복구 불가, 메모리·네트워크 부담 |
| 별도 DVR 서버 | 기능 강력 | 초기 운영 복잡도 증가 |
| **WebRTC + Egress HLS(선택)** | 실시간성과 전체 되감기 결합 | playlist 누적·시계 보정 검증 필요 |

## 영향·후속

- 녹화 중 전체 DVR playlist가 누적 갱신·재생되는지 LiveKit Egress+MinIO+nginx 실환경 PoC가 필요하다.
- Egress 시작 지연과 HLS media timestamp를 `sessionMs`로 보정하는 server clock 계약이 필요하다.
- WebRTC와 HLS를 동시에 전체 다운로드하지 않고, HLS는 되감기 사용 시 로드하는 방향으로 성능 측정한다.
- 현재 CP0 레슨 발행은 [ADR-0021](../songjeongki/0021-lesson-publish-mvp-direct.md)을 따른다. AI 준비 게이트는 파이프라인 도입 시점에 적용 여부를 다시 확정한다.
- 현재 실제 Egress 호출과 완료 webhook은 [ADR-0020](../songjeongki/0020-egress-recording-lifecycle.md)의 미검증·후속 항목을 따른다.

