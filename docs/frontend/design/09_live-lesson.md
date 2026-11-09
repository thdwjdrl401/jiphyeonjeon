# 라이브 레슨 (강의실)

> 원본: [../components/LIVE_LESSON.md](../components/LIVE_LESSON.md) · 로드맵: [00_ROADMAP.md](00_ROADMAP.md)

| 라우트 | 레이아웃 | 접근 |
|---|---|---|
| `/student/live-sessions/:sessionId/classroom`, `/instructor/live-sessions/:sessionId/classroom` | `LessonLayout` | 해당 커리큘럼 강사·수강생 (세션 `LIVE`일 때) |

## 목적
강사의 실시간 수업과 수강생의 시청·채팅·자막·AI 학습 기능을 한 화면에서 제공하는 전용 페이지. 새로고침·일시 단절·늦은 입장을 고려해 세션 상세와 분리되어 있다.

- 강사: 미디어 송출, 화면 공유, 세션 종료, 녹화·AI 상태·익명 질문 확인
- 수강생: 실시간 시청 전용(발행 권한 없음), 채팅, 자막·근거 확인, 개인 AI Q&A, 라이브 되감기

## 화면 구성

> 현재 UI 목업의 학습 사이드바와 자막 배치는 [ADR-0019](../../decisions/yoongwanghyeok/0019-unified-learning-sidebar-and-caption-dock-preview.md)에 따라 아래 기존 역할별 구성을 `채팅·질문 / 실시간 노트 / AI 질문 / 핵심 용어` 공통 4탭과 하단 자막 도크로 대체한다.
```text
LiveLessonHeader
├─ LessonIdentity
├─ LiveStatusBadge
├─ ConnectionStatus
└─ InstructorSessionActions          강사만

LiveLessonPrimaryContent
├─ LiveMediaStage                    — WebRTC 라이브 또는 HLS 되감기 중 하나만 표시
│  ├─ LiveRtcPlayer                  현재 LIVE 시청
│  ├─ LiveHlsPlayer                  되감기
│  ├─ MediaStateOverlay
│  └─ InstructorMediaControls        강사만 — 카메라/마이크/화면 공유
├─ LiveTimeline
│  ├─ PlaybackPosition
│  ├─ QuestionPinLayer               강사만 — 질문 발생 시점·집중도
│  └─ GoLiveButton                   — 빨간 점 표시, 현재 라이브로 즉시 복귀
└─ LiveCaptionRegion
   ├─ CurrentCaption                 — partial/final/revised 자막
   ├─ GlossaryPopover                — 전문용어 설명
   └─ EvidenceViewer                 — PPTX·발화 근거

LiveLessonSidePanel
├─ LiveChatPanel
│  ├─ LiveChatList
│  └─ LiveChatComposer
│     └─ QuestionFlagCheckbox        — "질문으로 등록" 체크
├─ PersonalAiQuestionPanel           — 개인 질문 입력 + 스트리밍 답변
├─ LessonMaterialPanel               — 공개된 PPTX 열람
├─ ParticipantSummary                — 참가자 수·연결 상태
└─ InstructorQuestionPanel           강사만 — 핀 선택 시 질문 개수·시각·익명 원문

LessonStatusRegion
├─ RecordingStatusNotice             강사만
├─ AiServiceStatusNotice
└─ ReconnectNotice
```

## 역할별 화면
| 항목 | 강사 | 수강생 |
|---|---|---|
| 미디어 | 카메라·마이크·화면 공유 제어 | 수신 전용(제어 버튼 없음) |
| 채팅 | 조회 | 작성 + "질문으로 등록" |
| 질문 인사이트 | 질문 핀 확인(익명 원문) | — |
| 개인 AI Q&A | — | 질문·답변·근거 이동 |
| 세션 종료 | O(확인 다이얼로그 필요) | — |

## 라이브 되감기
- 초기 입장은 항상 "현재 라이브"
- 타임라인은 라이브 시작부터 현재까지 계속 늘어남
- 과거 시점 선택 시 되감기(HLS)로 전환, `GoLiveButton`으로 언제든 현재 라이브로 복귀
- 현재 라이브일 때 `LIVE` 버튼 안의 점은 빨간색, 과거 재생 중에는 현재와의 시간 차이를 표시

## 부분 장애 처리 (영상·채팅은 최대한 유지)
| 장애 | 화면 동작 |
|---|---|
| AI Q&A 실패 | 영상·채팅 유지, AI 패널만 재시도 표시 |
| 자막/STT 실패 | 영상·채팅 유지, 자막 지연/중단 안내 |
| Egress 실패 | 라이브 시청 유지, 되감기/향후 VOD 위험 안내 |
| 채팅 실패 | 영상·자막 유지, 재연결·재전송 안내 |

## 페이지 상태
- 초기 로딩: 헤더 skeleton + 미디어 연결 준비, 권한 확인 전 강사 제어 UI 먼저 노출 금지
- 연결 중: LiveKit/WS 연결 상태를 분리 표시, 준비된 기능부터 순차 활성화
- 정상 LIVE: 전체 기능 활성
- 되감기 로딩·재생: 현재 라이브와의 시간 차이 표시
- 종료 감지: 메시지 작성·새 AI 질문 중단, 강사에게 종료 결과 안내, 수강생에게 VOD 준비 안내
- 접근 실패: 인증 만료/미수강/시작 전/종료 후를 구분해 안내

## 다음 화면
강사가 누른 "세션 종료" API가 성공하면 08_live-session의 녹화 처리 현황으로 자동 이동한다. 처리
화면은 `READY + PUBLISHED`를 확인한 뒤 강사 VOD로 다시 자동 이동한다. 수강생은
`session.ended`만으로 이동하지 않고 현재 HLS의 마지막 버퍼까지 재생하며, 명시적 버튼으로 레슨
상세에 돌아간다. 접근 실패는 11_system-pages(접근 불가)로 이동한다.
