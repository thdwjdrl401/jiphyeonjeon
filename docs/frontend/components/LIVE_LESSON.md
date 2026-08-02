# LiveClass AI — 라이브 레슨 컴포넌트

> 컴포넌트 원칙: [README.md](README.md) · 공통 레이아웃: [COMMON.md](COMMON.md) · 페이지 기준: [PAGES.md](../PAGES.md)

## 1. 목적

라이브 레슨은 강사의 실시간 수업과 수강생의 시청·채팅·자막·AI 학습 기능을 한 시간축에서 제공하는 전용 페이지다.

- 강사: 미디어 송출, 화면 공유, 라이브 세션 종료, 녹화·AI 상태와 익명 질문 흐름 확인
- 수강생: 실시간 시청, 채팅, 자막·근거 확인, 개인 AI Q&A, 북마크, 라이브 되감기

새로고침, 일시적인 연결 끊김, 늦은 입장, AI 부분 장애를 고려하여 레슨 상세와 분리하고 `LessonLayout`을 사용한다.

## 2. 현재 범위와 후속 범위

> **UI 목업 기준(2026-07-23)**: 학생·강사와 다시보기의 학습 사이드바는 `채팅·질문 / 실시간 노트 / AI 질문 / 핵심 용어` 네 탭으로 통일한다. 자막은 영상 하단 도크로 이동하고 영상 제어는 hover·focus 오버레이로 제공한다. 실제 API·WS·DVR 연결 전의 결정과 후속 범위는 [ADR-0019](../../decisions/yoongwanghyeok/0019-unified-learning-sidebar-and-caption-dock-preview.md)를 따른다.

### 2.1 현재 범위

- 강사는 카메라·마이크·화면 공유를 LiveKit으로 발행
- 수강생은 LiveKit에 참가하지 않고 HLS로만 시청
- 라이브 영상·음성, 실시간 채팅, 자막, 전문용어, PPTX·발화 근거
- 개인 AI Q&A
- 질문으로 등록한 채팅과 AI Q&A를 이용한 강사용 익명 질문 핀
- 북마크
- Egress HLS 하나로 라이브 엣지 재생과 되감기 제공
- 라이브 세션 종료와 Egress 녹화 상태 확인

LiveKit 토큰은 소유 강사의 WebRTC 송출에만 발급한다. 수강생은 인증된 HLS playback API를 사용하며 LiveKit token을 요청하지 않는다.

### 2.2 후속 구현

- 수강생 발언 요청
- 강사의 요청 승인·거절
- 승인된 수강생에게 일시적으로 마이크 발행 권한 부여
- 강사의 발언 권한 회수
- 늦은 입장·재접속 구간 따라잡기
- 유사 질문 묶음과 질문 밀도 히트맵

후속 기능은 컴포넌트 확장 지점을 남기되 현재 필수 컴포넌트나 API로 간주하지 않는다. 수강생 카메라와 화면 공유는 후속 발언 기능에도 포함하지 않는다.

## 3. 컴포넌트 트리

```text
LiveLessonPage
└─ LessonLayout
   ├─ LiveLessonPrimaryContent
   │  ├─ LiveMediaStage
   │  │  ├─ PlaybackPlayer                 HLS 라이브 엣지·되감기
   │  │  ├─ VideoStatusOverlay             제목·세션·연결·참여·강사 액션
   │  │  ├─ MediaStateOverlay
   │  │  └─ MediaControlsOverlay           진행 바·LIVE 복귀·역할별 제어
   │  └─ LiveCaptionDock
   │     ├─ CaptionSentenceList            sessionMs 문장 목록
   │     └─ CaptionTermLink                termId 선택
   ├─ LiveLessonSidePanel
   │  ├─ DiscussionPanel                   전체·질문 필터 + 채팅
   │  ├─ LiveSummaryPanel                  구간별 누적 요약 블록
   │  ├─ PersonalAiQuestionPanel
   │  └─ GlossaryPanel                     검색 목록 + 선택 상세
   ├─ LessonStatusRegion
   │  ├─ RecordingStatusNotice             강사만
   │  ├─ AiServiceStatusNotice
   │  └─ ReconnectNotice
   └─ SpeakerPermissionPanel                후속·강사만
```

수강생 미디어는 `PlaybackPlayer` 하나가 HLS 라이브 엣지와 되감기를 모두 담당한다. 강사의 LiveKit 발행은 별도 provider가 소유한다.

## 4. 컴포넌트 책임

### 4.1 페이지와 레이아웃 조합

| 컴포넌트 | 소유 영역 | 책임 |
|---|---|---|
| `LiveLessonPage` | `pages` | `sessionId` 기준 접근 권한·세션 상태 확인, 초기 데이터 조회, 실시간 연결과 feature 조합 |
| `LiveLessonHeader` | page 전용 | 상위 커리큘럼·섹션·레슨 정보와 핵심 상태 표시 |
| `LiveLessonPrimaryContent` | page 조합 | 미디어·타임라인·자막 영역 조합 |
| `LiveLessonSidePanel` | page 조합 | 역할에 맞는 채팅·AI·자료·질문 패널 조합 |
| `LessonStatusRegion` | `LessonLayout` 조합 | 연결·Egress·AI의 부분 장애와 복구 행동 안내 |

### 4.2 라이브 미디어와 되감기

| 컴포넌트 | 소유 영역 | 책임 |
|---|---|---|
| `LiveMediaStage` | `features/live` | HLS 재생과 공통 미디어 상태 표시 |
| `PlaybackPlayer` | `features/live` | Egress HLS 라이브 엣지·되감기·재연결 |
| `InstructorLiveMediaProvider` | `features/live` | 강사 LiveKit 트랙 발행·재연결 |
| `InstructorMediaControls` | `features/live` | 강사의 카메라·마이크·화면 공유 제어 |
| `LiveTimeline` | `features/live` | 라이브 시작부터 현재까지의 탐색 범위와 시각화 레이어 조합 |
| `GoLiveButton` | `features/live` | 빨간 점이 있는 `LIVE` 버튼과 HLS 라이브 엣지 복귀 |
| `BookmarkMarkerLayer` | `features/learning` | 수강생 북마크 위치 표시·선택 |
| `QuestionPinLayer` | `features/live-question` | 강사용 질문 발생 시점과 집중 정도 표시 |

### 4.3 실시간 학습 기능

| 컴포넌트 | 소유 영역 | 책임 |
|---|---|---|
| `LiveCaptionRegion` | `features/caption` | 현재 재생 시각에 맞는 자막·전문용어·근거 조합 |
| `CurrentCaption` | `features/caption` | `partial`·`final`·`revised` 자막 교체·갱신 |
| `GlossaryPopover` | `features/ai` | 전문용어의 짧은 설명 표시 |
| `AiEvidenceList` | `features/ai` | **구현됨** — 답변 `sources`를 접었다 펴는 근거 목록으로 표시(PPTX 쪽수 / 발화 구간) |
| `PersonalAiQuestionPanel` | `features/ai` | **구현됨** — 대화형(챗) 질의응답: 턴 이력, 낙관적 질문 표시, Enter 전송, SSE 누적, 중단·재시도 |
| `AiChatTurn` | `features/ai` | **구현됨** — 한 턴(내 질문 + AI 답변) 말풍선·상태·근거·재시도 렌더(memo) |
| `LessonMaterialPanel` | `features/lesson` | 레슨 전에 공개된 PPTX 자료 목록·열람 |

AI 패널은 일반적인 챗 UI 규약을 따른다(ADR-0049).

- 전송하면 내 질문이 **즉시** 이력에 붙고 입력창이 비워진다. 그 아래 AI 턴이 생겨 델타가 도착하는 대로 자란다.
- `Enter` 전송 / `Shift+Enter` 줄바꿈. 한글 IME 조합 중(`isComposing`) Enter는 전송하지 않는다.
- 응답 중에는 전송 버튼 자리가 `답변 중단`으로 바뀐다(질문 겹침 방지 + `AbortController` 취소).
- 새 델타·새 턴은 하단을 따라가되, 사용자가 위로 올려 읽는 중이면 끌어내리지 않는다(하단 48px 이내일 때만).
- 상태별 표현: `done`은 근거 토글, `insufficient`는 **오류가 아닌 안내**(재시도 없음), `error`는 메시지 + `retryable`일 때만 재시도.
- **이력은 클라이언트 메모리뿐이다.** 서버 AI Q&A 이력 API(`AI-HISTORY-01`)가 없어 새로고침·탭 재마운트면 사라지며, 화면도 입력창 옆에서 이를 밝힌다("대화는 이 화면에서만 유지되며 새로고침하면 사라집니다").

**근거 표시**(ADR-0049 §8) — 370px 패널에서 근거가 답변보다 자리를 먹지 않게, 기본은 접혀 있다.

- 답변 아래에는 `근거 n` **토글 한 줄**만 남고(근거가 0개면 토글도 없다), 누르면 그 자리에서 목록이 펼쳐진다. 모달·사이드패널을 열지 않는다.
- 펼침은 **턴별로 독립**이며 상태를 저장하지 않는다 — 새 턴은 항상 접힌 채로 붙는다.
- 토글은 실제 `<button>` + `aria-expanded`·`aria-controls`라 키보드(`Enter`/`Space`)로 열고 닫는다. 목록은 접힌 동안 `hidden`이라 접근성 트리에서도 빠진다.
- 항목 하나가 한 줄이다: `12쪽 · 강의 자료 · mat-c3f1…` / `12:08–12:41 · 강의 발화 · stt-9a2b…`. `sources`에 **자료 제목이 없어** UUID뿐이므로 사람이 읽는 값(쪽수·시각)을 앞세우고 ID는 앞 8자로 줄인다(전체 값은 `title` 속성).
- 발화 근거는 **여전히 누를 수 없다**(ADR-0047 §9 — `startMs`/`endMs`가 STT attempt-local 축이라 seek에 쓰면 엉뚱한 지점으로 간다). 그 이유는 **펼친 목록 아래에 한 번만** 적는다.
- 펼침 애니메이션은 `prefers-reduced-motion: reduce`에서 생략한다.

### 4.4 채팅과 질문 인사이트

| 컴포넌트 | 소유 영역 | 책임 |
|---|---|---|
| `LiveChatPanel` | `features/chat` | 실시간 메시지 조회·수신·작성 상태 조합 |
| `LiveChatComposer` | `features/chat` | 메시지와 질문 등록 여부 입력·전송 |
| `QuestionFlagCheckbox` | `features/chat` | 작성 메시지를 강사용 질문 집계에 포함할지 명시 |
| `InstructorQuestionPanel` | `features/live-question` | 선택한 핀의 질문 개수·시각·익명 원문 표시 |
| `ParticipantSummary` | `features/live` | 참가자 수와 접속 상태 요약 |

질문 핀에는 다음 두 출처를 포함한다.

- 수강생이 `질문으로 등록`을 체크한 라이브 채팅
- 수강생이 개인 AI Q&A에 입력한 질문

일반 채팅을 문장 내용만으로 자동 분류하지 않는다. 강사는 학생 식별 정보 없이 질문 원문을 확인하며, 초기에는 유사 질문을 자동으로 묶지 않는다.

## 5. 접근 권한과 미디어 권한

### 5.1 페이지 접근

- 해당 커리큘럼 강사 또는 수강생만 접근
- 비로그인·미수강 학생·다른 커리큘럼 강사는 라우트 진입 단계에서 차단
- 강사는 `/instructor/live-sessions/:sessionId/classroom`, 학생은 `/student/live-sessions/:sessionId/classroom`에서 `liveSessionStatus=LIVE`일 때 입장
- 강사의 종료 API 성공은 녹화 processing 화면으로 이동. 수강생은 `session.ended`만으로 이동하지 않고
  현재 HLS의 마지막 버퍼까지 재생
- 권한과 상태는 프론트 라우트 가드뿐 아니라 서버에서도 검증

### 5.2 강사

- LiveKit 미디어 발행·구독
- 카메라·마이크·화면 공유 제어
- 라이브 세션 종료
- 녹화·AI 상태와 질문 핀 확인

### 5.3 수강생

- LiveKit 미디어 구독만 허용
- 카메라·마이크·화면 공유 제어를 현재 UI에 노출하지 않음
- 채팅과 AI Q&A는 Spring의 WS·REST·SSE 경로를 사용
- 후속 발언 기능 도입 전까지 LiveKit 발행 권한을 부여하지 않음

## 6. 라이브 재생과 되감기

### 6.1 재생 모드

프론트 내부 재생 모드는 다음 세 가지로 구분한다. 이는 UI 상태이며 API 상태 계약이 아니다.

| 재생 모드 | 소스 | 사용 조건 |
|---|---|---|
| `RTC_LIVE` | LiveKit WebRTC | 현재 라이브 시청 |
| `HLS_RECENT` | Egress 최근 HLS 플레이리스트 | 현재에 가까운 구간 되감기 |
| `HLS_DVR` | Egress 전체 누적 HLS 플레이리스트 | 최근 범위보다 이전 구간 탐색 |

사용자에게는 세 소스를 구분하지 않고 하나의 연속된 타임라인으로 제공한다.

### 6.2 기본 동작

- 초기 입장은 `RTC_LIVE`
- 타임라인 범위는 라이브 시작 시점부터 현재 시점까지 계속 증가
- 사용자가 과거 시점을 선택하면 적합한 HLS 소스로 전환
- 최근 HLS 범위를 벗어나면 같은 `sessionMs`를 유지한 채 전체 DVR HLS로 전환
- HLS 소스 전환 중에는 `이전 구간을 불러오는 중` 상태 표시
- `GoLiveButton` 선택 시 HLS를 중단하고 `RTC_LIVE`로 복귀
- 현재 라이브일 때 `LIVE` 버튼 안의 점을 빨간색으로 표시
- 과거 재생 중에는 현재 라이브와의 시간 차이를 표시

### 6.3 Egress와 HLS 전제

- 라이브 시작과 함께 Egress HLS 세그먼트 생성을 시작
- 최근 플레이리스트는 가까운 범위의 빠른 되감기에 사용
- 전체 DVR 플레이리스트는 라이브 시작 이후의 모든 세그먼트를 유지
- 라이브에서 만든 세그먼트는 종료 후 VOD에도 재사용
- 최근·전체 HLS URL과 사용 가능 범위는 서버가 권한 검증 후 제공

전체 플레이리스트가 녹화 중에도 누적 갱신·재생 가능한지는 Egress 구성 단계에서 검증한다. 지원되지 않으면 서버가 저장된 세그먼트를 기준으로 누적 DVR 플레이리스트를 제공해야 한다.

### 6.4 사전 로딩 원칙

- WebRTC 시청 중 HLS 영상 전체를 항상 중복 다운로드하지 않음
- 최근 플레이리스트 메타데이터나 최소 준비 정보만 유지하는 방식을 우선
- 실제 되감기 사용 시 HLS 세그먼트 로딩 시작
- 초기 측정 후 필요하면 최근 구간의 제한적인 사전 버퍼링 도입

## 7. 세션 시간축과 동기화

영상·자막·채팅·질문·북마크는 라이브 세션 시작 기준 상대 밀리초를 공통 좌표로 사용한다.

```text
sessionMs
├─ WebRTC 현재 시점
├─ HLS 세그먼트 시점
├─ 자막 구간
├─ 채팅 전송 시점
├─ AI 질문 시점
├─ 질문 핀
└─ 북마크
```

- 화면 표시용 시각은 공통 세션 시계에서 계산
- WebRTC↔HLS 전환 시 같은 `sessionMs` 유지
- `partial`은 동일 자막 구간을 교체하고 `revised`는 기존 확정 구간 갱신
- 북마크 선택 시 해당 시점으로 이동하되 현재 LIVE 상태라면 HLS로 전환될 수 있음
- Egress 시작 지연이나 재연결로 생긴 오프셋은 서버 기준 세션 시각으로 보정

되감기 중 표시할 채팅 범위와 질문 채팅의 기준 시각은 미확정 사항에서 별도로 결정한다.

## 8. 강사 화면

### 8.1 수업 운영

- 카메라·마이크 상태 확인·제어
- 화면 공유 시작·중지
- 참가자 수와 연결 상태 확인
- 녹화 준비·진행·실패 상태 확인
- 자막·AI 연결 상태 확인
- 라이브 세션 종료

라이브 세션 종료는 중복 실행을 막고 확인 절차를 제공한다. 종료 요청 후 `ENDING`을 표시하고
결과가 확정될 때까지 기다린다. session이 `ENDED`가 되어도 Egress HLS 처리 상태는 별도로 안내한다.

### 8.2 질문 인사이트

- 전체 질문 개수
- 시간대별 질문 핀
- 질문이 집중된 시점의 시각적 강조
- 핀 선택 시 질문 발생 시각과 익명 원문 확인
- 해당 시각의 자막·근거로 이동

초기 질문 핀은 개별 질문 또는 같은 짧은 시간 구간의 개수 표시만 제공한다. 의미 기반 유사 질문 묶음은 후속 기능이다.

## 9. 수강생 화면

- 실시간 영상·음성·화면 공유 수신
- 실시간 채팅 작성과 `질문으로 등록` 선택
- 현재 재생 시각에 맞는 자막·용어·PPTX·발화 근거 확인
- 개인 AI Q&A와 답변 근거 확인
- 현재 시점 북마크
- 라이브 시작부터 현재까지 되감기
- 빨간 점이 있는 `LIVE` 버튼으로 현재 시점 복귀

수강생의 카메라·마이크·화면 공유 버튼은 현재 제공하지 않는다. 후속 발언 기능이 도입되면 발언 요청과 승인된 마이크 제어만 추가한다.

종료 상태별 학생 동작은 HLS 지연을 기준으로 구분한다.

- `ENDING`: 종료 처리 중에도 채팅·AI 질문·HLS·자막 시각 이동을 유지한다.
- `ENDED`: 강사 송출과 LiveKit Room만 종료된 상태다. 학생에게 **“송출이 종료되어 남은 영상을
  재생 중입니다”** 같은 별도 배너·토스트·오버레이를 표시하지 않고, 재생 중인 HLS와 자막 시각 이동을
  그대로 유지한다. 채팅 작성·AI 질문·재시도와 진행 중 AI SSE도 유지한다.
- `caption.stream.completed`: 새 자막 생성만 종료한다. 기존 자막은 남은 HLS의 player 위치에 맞춰
  계속 노출하고 HLS를 사용할 수 있는 동안 시각 이동도 유지한다.
- `VideoAsset READY`: 최종 HLS 확정 신호다. 즉시 player를 중지하지 않고 마지막 버퍼를 소비한
  browser player의 `ended`에서 해당 학생의 재생을 완료한다.

## 10. 연결과 장애 처리

### 10.1 초기 연결

1. `sessionId` 기준 인증·수강·강사 소유권과 `liveSessionStatus` 확인
2. 라이브 세션·lesson·허용 행동 조회
3. LiveKit 토큰과 재생 정보 획득
4. LiveKit 연결
5. 채팅·자막 WebSocket 연결
6. 필요한 REST·SSE 기능 준비

미디어가 준비되기 전까지 강사·수강생 역할에 맞는 연결 상태를 표시한다.

### 10.2 일시 단절

- LiveKit 재연결 상태 표시
- 채팅·자막 WS를 각각 재연결
- 채팅은 REST로 누락 구간 복구
- 복구 가능한 영역은 페이지 전체 오류로 전환하지 않음
- 재연결 후 서버 세션 시각으로 현재 위치 재보정

### 10.3 부분 장애

| 장애 | 페이지 동작 |
|---|---|
| AI Q&A 실패 | 영상·채팅 유지, AI 패널에서 재시도 |
| 자막/STT 실패 | 영상·채팅 유지, 자막 지연·중단 안내 |
| Egress 실패 | WebRTC 라이브 유지, 되감기·향후 VOD 위험 안내 |
| 최근 HLS 실패 | 가능하면 전체 DVR HLS로 대체 |
| 전체 DVR HLS 실패 | WebRTC LIVE 복귀 제공 |
| 채팅 실패 | 영상·자막 유지, 재연결·재전송 안내 |
| LiveKit 실패 | 미디어 재연결 우선, 다른 실시간 영역 상태 유지 여부 안내 |

AI 장애가 라이브 미디어와 채팅을 막지 않는 것을 기본 원칙으로 한다.

## 11. 페이지 상태

### 11.1 초기 로딩

- 접근 권한과 라이브 상태 확인
- 레슨 헤더 skeleton과 미디어 연결 준비 표시
- 권한 확인 전 강사 제어 UI를 먼저 노출하지 않음

### 11.2 연결 중

- LiveKit·WS 연결 상태를 분리해서 표시
- 일부 연결이 완료되면 사용할 수 있는 기능부터 활성화

### 11.3 정상 LIVE

- WebRTC 미디어와 실시간 기능 표시
- 강사·수강생 역할에 맞는 행동 활성화
- 라이브 타임라인 범위 계속 갱신

### 11.4 되감기 로딩·재생

- 선택한 시점과 현재 LIVE의 차이 표시
- 최근·전체 HLS 전환 시 로딩 표시
- 언제든 `GoLiveButton`으로 현재 LIVE 복귀

### 11.5 종료 감지

- `/topic/live-sessions/{sessionId}/state`의 `session.ending`은 종료 처리 상태만 갱신
- `session.ended` 또는 최초 REST 조회의 `ENDED`는 강사 송출·Room 종료로만 해석
- `session.ended`만으로 종료 안내를 표시하거나 HLS player·자막 시각 이동·미적용 seek를 중단하지 않음
- `caption.stream.completed` 뒤 동일 attempt의 새 자막을 만들지 않고 기존 자막은 유지
- `VideoAsset FINALIZING/VERIFYING` 동안 기존 HLS 접근과 manifest 갱신 유지
- `READY` 뒤 마지막 세그먼트를 재생하고 player `ended`에서 학생별 미디어 재생 완료
- 메시지 작성·새 AI 질문·AI 재시도와 진행 중 AI SSE는 유지
- 강사에게 종료 결과와 Egress 처리 상태 안내
- 기존 HLS 플레이어와 채팅·AI 대화·자막 유지

> 구현 상태: 위 drain 정책은 [ADR-0005](../../decisions/choinhoo/0005-ended-hls-caption-drain.md)로
> 확정됐으나, 현재 `LiveClassroomPage`의 `ENDED` 배너·자막 seek 잠금과 backend playback의
> `ENDED` 즉시 replay 판정에는 아직 코드 반영이 필요하다.

### 11.6 접근 실패

- 인증 만료, 미수강, 다른 강사의 레슨, 시작 전, 종료 후를 구분
- 복구 가능한 목적지로 이동

## 12. 주요 사용자 행동

### 12.1 공통

- 실시간 영상·자막·채팅 확인
- 전문용어와 PPTX·발화 근거 확인
- 패널 전환
- 연결 실패 재시도

### 12.2 강사

- 카메라·마이크·화면 공유 제어
- 녹화·AI 상태 확인
- 질문 핀 선택과 익명 원문 확인
- 라이브 세션 종료

### 12.3 수강생

- 채팅 작성과 질문 등록 여부 선택
- 개인 AI 질문과 근거 확인
- 북마크 저장·이동
- 최근 또는 전체 구간 되감기
- 현재 LIVE 복귀

## 13. 필요한 데이터와 연결

정확한 필드와 API는 [API_MAP.md](../api/API_MAP.md)에서 확정한다.

### 13.1 초기 데이터

- 커리큘럼·섹션·레슨 식별 정보
- 현재 사용자와 레슨의 관계
- `sessionId`·`lessonId`
- `liveSessionStatus`와 라이브 세션 시작 시각
- 역할별 허용 행동
- LiveKit 연결 정보와 권한이 제한된 토큰
- 최근 HLS·전체 DVR HLS 재생 정보와 각 탐색 가능 범위
- Egress 녹화 상태
- PPTX 자료 목록

### 13.2 실시간 데이터

- 참가자와 LiveKit 트랙 상태
- 채팅 메시지와 질문 등록 여부
- `partial`·`final`·`revised` 자막
- 전문용어·자료·발화 근거
- AI Q&A 요청·스트리밍 답변
- 질문 핀 집계와 익명 원문
- 라이브 세션 `ENDING`·`ENDED` 이벤트

### 13.3 학습 데이터

- 북마크
- 현재 재생 `sessionMs`
- 후속 구현 시 따라잡기 결과

## 14. 반응형과 접근성

- 데스크톱은 미디어와 보조 패널을 나란히 배치
- 좁은 화면은 채팅·AI·자료를 탭 또는 drawer로 전환
- 미디어와 자막을 가리는 패널 중첩 최소화
- 자막 영역에 적절한 live region 적용 여부를 구현 시 검증
- 질문 체크박스와 `LIVE` 버튼은 색상 외 텍스트·상태 정보도 제공
- 타임라인 질문 핀과 북마크는 키보드로 탐색 가능해야 함
- 강사 종료 행동은 확인 대화상자와 명확한 포커스 복귀 제공

## 15. 미확정 사항

1. 최근 HLS의 유지 시간과 세그먼트 개수
2. WebRTC 시청 중 최근 HLS를 어느 수준까지 사전 준비할지
3. 자체 구축 Egress에서 전체 플레이리스트를 녹화 중 누적 제공하는 방식
4. 되감기 중 채팅을 현재 라이브 기준으로 유지할지 재생 시각에 동기화할지
5. 되감기 중 작성한 질문 채팅의 핀 시각을 전송 시각과 시청 시각 중 무엇으로 할지
6. 강사용 질문 집중 시점의 시간 구간과 강조 기준
7. 라이브 세션 종료 확인·취소 가능 구간과 종료 실패 복구 방식
8. 참가자 목록에서 수강생에게 공개할 정보 범위
9. 후속 발언 요청을 도입할 CP와 마이크 권한 유지 시간
10. 모바일에서 보조 패널을 탭과 drawer 중 어떤 방식으로 제공할지

## 16. 이후 기능 후보

- 발언 요청과 강사 승인 기반 수강생 마이크 허용
- 늦은 입장·재접속 구간 AI 따라잡기
- 유사 질문 자동 묶음
- 질문 밀도 히트맵
- 강사의 질문 처리·답변 완료 표시
- 네트워크 품질 기반 자동 화질 안내

후보 기능은 채택되기 전까지 필수 컴포넌트나 API로 간주하지 않는다.
