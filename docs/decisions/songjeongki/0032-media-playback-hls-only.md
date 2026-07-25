# ADR-0032: 학생 재생은 HLS 단일 — LiveKit은 인제스트·Egress·STT로 유지 (WebRTC 직접 재생 폐기)

> 📍 하네스 개요: [../../harness/README.md](../../harness/README.md) · 판단 정책: [../../harness/POLICY.md](../../harness/POLICY.md) · 아키텍처: [../../ARCHITECTURE.md](../../ARCHITECTURE.md)

- **상태**: 채택
- **일자**: 2026-07-24 (제안) · 2026-07-26 (채택)
- **관련**: [0004](0004-media-livekit-selfhost.md)(LiveKit self-host), [0010](0010-self-host-vod.md)(Egress VOD), [0013](0013-unified-streaming-stt.md)(스트리밍 STT), [0008](0008-ai-bus-redis-streams-session-clock.md)(세션 시계) · FE 계약 [LIVE.md §7](../../frontend/api/LIVE.md)

## 맥락 (Context)

현재 설계는 학생 화면에 **두 개의 플레이어**를 강제한다:
- 현재 시점 = LiveKit WebRTC 직접 구독 렌더
- 과거 시점 = HLS.js 재생

근거: [ARCHITECTURE.md:40](../../ARCHITECTURE.md)(FE 스택에 `LiveKit client · HLS.js` 둘 다), [LIVE.md:329](../../frontend/api/LIVE.md)("WebRTC 현재 시점은 LiveKit, 과거 시점은 HLS를 사용"). 라이브 중 DVR HLS를 주는 `LIVE-PLAYBACK-01`은 아직 **"제안"** 상태이고, §7 말미에 "구현 전 인프라 검증 필요"라고 명시돼 있다. FE에 플레이어 구현은 아직 없다(`hls.js`·`livekit-client` 미설치) — 지금이 정할 시점이다.

두 플레이어는 서로 다른 코드 경로·상태·장애 처리(WebRTC↔HLS 전환, fallback)를 요구한다. 이 복잡도가 정당한지 물으면, 이 제품의 상호작용 모델이 답을 준다:
- 수강생은 **subscribe-only**(`canPublish=false`, [LIVE.md:26](../../frontend/api/LIVE.md)). 발행하지 않는다.
- 카메라·화면공유는 **강사 전용**. 수강생 카메라/화면은 후속 발언 기능에서도 제외([LIVE_LESSON.md](../../frontend/components/LIVE_LESSON.md)).
- 모든 상호작용이 **비동기** — 채팅, AI Q&A(SSE), 북마크, 퀴즈.

즉 이 제품은 **사실상 단방향 방송 + 비동기 상호작용**이다. 그렇다면 WebRTC의 서브초 지연이 *시청* 쪽에서 사주는 이득이 거의 없다. 여기서 "그러면 LiveKit이 필요 없는 것 아니냐"는 의심이 자연스럽게 따라오는데, 이 ADR은 그 의심까지 정면으로 다룬다.

## 결정 (Decision)

1. **학생 재생 플레이어는 HLS 단일로 한다.** 라이브 = "HLS를 라이브 엣지에서 재생", 다시보기 = "같은 HLS를 과거로 seek". **클라이언트 측 WebRTC 직접 구독·렌더 경로는 폐기**한다.
2. **LiveKit은 그대로 유지한다** — 역할은 (a) 강사 브라우저의 **다중 트랙(카메라·화면·마이크) WebRTC 인제스트**, (b) **Egress의 서버측 합성 → HLS 생성**, (c) **Agents의 STT 오디오 탭**. 학생 렌더 경로만 뺀다.
3. 자막은 HLS가 아니라 **LiveKit 오디오에서 탭**한다(realtime-agent). 영상보다 덜 지연될 수 있고, **sessionMs로 HLS 재생 위치에 정렬**한다([0008](0008-ai-bus-redis-streams-session-clock.md)).

## 근거 (Rationale)

### 왜 HLS 단일인가

- **단방향 + 비동기 제품에서 서브초 지연은 시청 쪽 이득이 거의 없다.** YouTube Live·Twitch가 HLS류 지연으로 돌고 아무도 문제 삼지 않는 것과 같다.
- **플레이어 1개 = 큰 단순화.** 이중 코드 경로·WebRTC↔HLS 전환·fallback 상태가 사라진다. seek/되감기가 HLS에 내장돼 공짜로 따라온다.
- **제품의 핵심 차별점을 오히려 강화한다.** 라이브를 "라이브 엣지 재생", 다시보기를 "과거 seek"으로 두면 **라이브와 다시보기가 문자 그대로 같은 컴포넌트**가 된다. sessionMs 단일 시간축 위 자막 정렬(이 프로젝트의 1번 차별점, [0008](0008-ai-bus-redis-streams-session-clock.md))이 그대로 재사용된다. "라이브·다시보기 연속성"이라는 기획 명제와 정합한다.

### 왜 그래도 LiveKit인가 — "필요 없다"는 의심의 해소

의심은 **반쯤만 맞다.** 정확히는 *클라이언트 WebRTC 재생*이 필요 없는 것이지, *LiveKit*이 필요 없는 게 아니다. 둘은 다르다.

- **브라우저 라이브 미디어는 어딘가에서 종단돼야 한다.** 브라우저의 네이티브 실시간 송출 경로는 WebRTC(WebRTC 서버 필요) 또는 MediaRecorder 청크 업로드(취약)뿐이다. RTMP 직접 송출은 안 되고, WHIP은 그 자체가 WebRTC 인제스트다. 그래서 진짜 선택지는 "LiveKit이냐 아무것도 안 쓰냐"가 아니라 **"LiveKit이냐 다른 미디어 서버를 직접 조립하냐"**다. 후자는 [ADR-0004](0004-media-livekit-selfhost.md)가 Kurento를 버리며 피한 조립 부담(인제스트 + HLS 패키징 + STT 배선 + 녹화)을 되살린다.
- **강사 다중 트랙 송출이 현재형 명분을 준다.** 강사가 얼굴+화면을 동시에 보낼 때, LiveKit은 강사 브라우저가 두 트랙을 **native로 발행**만 하고 **Egress가 서버에서 레이아웃을 합성**해 하나의 HLS로 만든다. RTMP류 단순 인제스트는 강사가 미리 합성한 한 스트림만 받으므로(OBS 설치 등), 브라우저-only 강사 경험에서 훨씬 불리하다. 이건 SFU 라우팅이 아니라 **다중 트랙 인제스트 + Egress 합성**에 대한 명분이며, 로드맵(발언 기능) 없이 **지금 당장** 성립한다.
- **STT를 LiveKit에서 뽑는 건 축소가 아니라 기능이다.** 영상이 HLS로 지연될 때 자막까지 HLS에서 뽑으면 이중 지연이 된다. LiveKit 오디오 탭은 자막을 덜 지연시키고, 이미 sessionMs 정렬 인프라가 있어 재생 위치에 맞춰 표시하면 된다.
- **HLS의 원천이 Egress다.** "최신 HLS = 라이브"의 그 HLS를 LiveKit Egress가 만든다. LiveKit은 곁가지가 아니라 미디어의 출처다.

정리하면: **HLS 단일 재생은 LiveKit을 불필요하게 만드는 게 아니라, LiveKit의 *SFU 기능을 휴면*시키고 *인제스트+Egress+STT 탭*은 하중을 받게 한다.**

## 대안 (Alternatives)

| 대안 | 장점 | 단점 |
|---|---|---|
| **HLS 단일 재생 + LiveKit 인제스트/Egress/STT (선택)** | 플레이어 1개, 라이브=다시보기 동일 컴포넌트, sessionMs 정렬 재사용, 강사 다중 트랙 합성, 되돌아올 문 유지 | 라이브 체감 지연 수 초(Egress→HLS), 인터랙티브 음성엔 부적합 |
| 이중 플레이어(WebRTC 라이브 + HLS 다시보기) 유지 | 라이브 서브초 지연 | FE 이중 경로·전환·fallback, 인터랙티브 발행이 실제로 없으면 복잡도만 부담 |
| LiveKit 제거 + WHIP→HLS 얇은 미디어 서버(MediaMTX/SRS 등) | 스택 경량, SFU 미사용분 제거 | 인제스트+HLS+STT+녹화 직접 배선(0004가 피한 churn), 발언 기능 시 전환 비용 이중 지불, 다중 트랙 합성 직접 |
| MediaRecorder 청크 업로드 → 서버 ffmpeg → HLS | WebRTC 서버 자체가 불필요 | 적응 비트레이트·재연결·백프레셔·합성 전부 DIY, 취약·고지연 |

**LiveKit 제거안을 진지하게 검토할 조건**: 이 제품이 *영원히* 완전 단방향이라고 확신될 때. 강사 다중 트랙 송출과 발언 기능 가능성이 그 확신을 막으므로, 현 시점 선택은 유지다.

## 영향·후속 (Consequences)

- FE 플레이어를 **HLS.js 단일 컴포넌트**로 구현한다. 라이브=라이브 엣지, 다시보기=seek. `livekit-client`는 **강사 발행 화면(preflight·classroom publish)에만** 남고, 학생 classroom에서는 쓰지 않는다.
- [LIVE.md §7](../../frontend/api/LIVE.md)의 "WebRTC 현재 / HLS 과거" 및 fallback 매트릭스(최근 HLS 실패→DVR, 전체 HLS 실패→WebRTC 복귀)를 **HLS 단일** 기준으로 갱신한다. `LIVE-PLAYBACK-01`(제안)을 이 결정 위에서 확정한다.
- 자막·용어·근거·북마크·퀴즈는 계속 **sessionMs** 좌표로 오고, 플레이어는 현재 HLS 재생 sessionMs에 맞춰 정렬한다. 자막이 영상보다 앞설 수 있으므로 **caption을 HLS 재생 위치에 맞춰 버퍼링/정렬**하는 로직이 FE에 필요하다.
- [ARCHITECTURE.md](../../ARCHITECTURE.md)의 FE 스택 서술과 미디어 다이어그램(`FE --WebRTC--> LK` 학생 경로)을 갱신한다.

### 채택 노트 (2026-07-26)

학생 HLS 단일 재생을 **확정**한다. 아래 Egress→HLS 지연 실측은 채택을 막는 블로커에서 **인프라 후속 검증**으로 전환한다 — 아키텍처 방향(플레이어 1개·라이브=다시보기 동일 컴포넌트)은 이 값과 무관하게 성립하고, 값은 "라이브 엣지"의 체감 지연만 좌우하기 때문이다. 실측이 과도하면(예: 두 자릿수 초) 대안 표의 조건부로 라이브 경로만 재검토한다.

**문서 정합화 완료 (2026-07-26).** 위 "영향·후속"의 문서 갱신을 반영했다:
- `ARCHITECTURE.md` — FE 스택 표기(`LiveKit client(강사 발행) · HLS.js(재생)`), 미디어 다이어그램 엣지(`WebRTC 발행(강사)`), §6-1 라이브 시퀀스(학생 WebRTC 구독 → HLS 라이브 엣지 재생, `OBJ` 참가자 추가, 상태 🟡), 원칙 4(학생 시청=HLS 스토리지 직결).
- `frontend/api/LIVE.md` — §6 classroom 초기화(강사만 LiveKit 토큰), §7 재생 모델(HLS 단일, `live.m3u8` 엣지/seek), §14 장애 매트릭스(WebRTC 복귀 경로 제거, Egress=라이브 유일 원천 명시).
- LIVE-PLAYBACK-01 응답 스키마 자체(`recent`/`dvr`)는 재생 API(liveclass-100, 제안) 소유라 이번엔 미변경 — 주변 의미만 HLS 단일로 정리했다.

### 후속 검증 — 실측 필요 (비블로커, 위 채택 노트 참고)

- **Egress → HLS 지연.** "최신 HLS = 라이브"는 그 지연이 **한 자릿수 초**일 때만 자연스럽다. 표준 Egress HLS는 10~30초까지도 나올 수 있고, 그러면 강사가 채팅 반응을 한참 늦게 보는 스트리머 딜레이가 된다. **LL-HLS로 2~6초에 들어오는지 인프라 실측**으로 확인하고, 과도하면 "라이브 엣지" 전제를 재검토한다(재생 아키텍처 자체는 유지).

### 확인해두면 좋은 것 (비블로커)

- **수강생 실시간 발언 기능의 로드맵 여부.** 있으면 SFU 라우팅이 되살아나 이 결정을 더 강하게 뒷받침한다. 없어도 강사 다중 트랙 송출로 LiveKit 명분은 유지된다(그래서 블로커가 아님).
