# VOD 레슨

> 원본: [../components/VOD_LESSON.md](../components/VOD_LESSON.md) · 로드맵: [00_ROADMAP.md](00_ROADMAP.md)

| 라우트 | 레이아웃 | 접근 |
|---|---|---|
| `/lessons/:lessonId/replay` | `LessonLayout` | 해당 커리큘럼 강사·수강생 |

## 목적
종료된 라이브 레슨의 녹화(HLS)를 재생하며, 교정 자막·채팅 리플레이·PPTX 근거·개인 AI Q&A·북마크·퀴즈를 같은 시간축에서 제공하는 학습 페이지. 강사는 같은 화면에서 AI 결과를 검수·게시한다. 영상 업로드 기능은 없다(녹화 결과만 사용).

## 게시본 개념 (화면에 꼭 반영해야 하는 개념)
- 강사만 보는 "AI 원본/후보"와 수강생이 보는 "게시본"은 분리되어 있다.
- 강사가 검수·승인해야 수강생에게 노출된다. 미검수 상태를 수강생에게 보여주지 않는다.
- 새 정상 영상은 HLS 검증 성공 시 자동 공개되고, AI 콘텐츠 게시 여부와 무관하게 먼저 재생할 수 있다.
  자막·용어·챕터·퀴즈는 각각 독립적으로 준비·검수·게시한다.

## 화면 구성

> 현재 UI 목업의 학습 사이드바와 자막 배치는 [ADR-0019](../../decisions/yoongwanghyeok/0019-unified-learning-sidebar-and-caption-dock-preview.md)에 따라 라이브와 같은 `채팅·질문 / 실시간 노트 / AI 질문 / 핵심 용어` 공통 4탭과 하단 자막 도크를 사용한다. 검수·통계·퀴즈 최종 위치는 후속 범위다.
```text
VodLessonHeader
├─ LessonIdentity
├─ ContentPublicationBadge         — 영역별 게시 상태 배지
└─ InstructorReviewEntry           강사만

VodLessonPrimaryContent
├─ VodPlayerStage
│  ├─ HlsVodPlayer
│  ├─ VodPlayerControls            — 재생/탐색/음량/배속/전체화면
│  └─ PlaybackStateOverlay
├─ VodTimeline
│  ├─ ChapterMarkerLayer
│  ├─ BookmarkMarkerLayer          수강생
│  └─ QuestionPinLayer             강사만
└─ VodCaptionRegion
   ├─ PublishedCaption
   ├─ GlossaryPopover
   └─ EvidenceViewer

VodLessonSidePanel
├─ TranscriptSearchPanel           — 자막 키워드 검색 → 해당 시점 이동
├─ ChapterNavigationPanel          — 구간 제목·시작 시각·설명
├─ ChatReplayPanel                 — 시간 동기화 채팅 리플레이(읽기 전용)
├─ PersonalAiQuestionPanel
├─ LessonMaterialPanel
├─ BookmarkPanel                   수강생
└─ QuizPanel                       — 게시된 퀴즈 응시

StudentLearningStatus              수강생 — 마지막 시점·진행률·완료 상태

InstructorVodPanel                 강사만
├─ InstructorReviewPanel
│  ├─ ReviewStatusSummary          — 자막/용어/챕터/퀴즈별 후보·검수·게시 상태
│  ├─ TranscriptReviewEditor
│  ├─ GlossaryReviewEditor
│  ├─ ChapterReviewEditor
│  └─ QuizReviewEditor
├─ InstructorQuestionPanel         — 질문 핀·익명 원문
└─ LessonLearningSummary           — 수강생 재생·완료·퀴즈 응시 집계

LessonStatusRegion
├─ PlaybackErrorNotice
└─ AiContentStatusNotice
```

강사 검수 패널은 재생 화면을 완전히 가리지 않는 형태로 배치한다(같은 시점을 보면서 검수).

## 영상/공개/AI 상태 조합 → 수강생 화면
| 영상 자산 | 다시보기 공개 | AI 콘텐츠 | 수강생 화면 |
|---|---|---|---|
| 처리 중 | 무관 | 무관 | 레슨 상세에서 "준비 중" 안내(이 화면 진입 안 함) |
| 준비 완료 | 기존 미게시 | 무관 | 기존 자산만 "게시 대기" 안내, 재생 불가 |
| 준비 완료 | 공개됨 | 처리 중/미게시 | 영상 재생, 해당 AI 영역만 "준비 중" |
| 준비 완료 | 공개됨 | 일부 게시 | 영상 + 게시된 AI 영역만 표시 |
| 준비 완료 | 공개 중단 | 무관 | 공개 중단 안내, 재생 불가 |

## 시점 이동 통합
자막 검색 결과·챕터 선택·AI 답변 근거·PPTX 근거·북마크·퀴즈 연결 구간·강사 질문 핀 — 이 모두가 같은 "플레이어 시점 이동"으로 동작해야 한다(하나의 상호작용 패턴으로 디자인).

## 강사 검수 흐름 (화면 내 단계)
1. 검수 영역 선택(자막/용어/챕터/퀴즈)
2. 후보·검수 초안·현재 게시본 비교
3. 수정본 저장(임시 저장 ≠ 게시)
4. 게시 → 수강생 화면 즉시 교체

## 페이지 상태
- 초기 로딩: 권한·상태 확인 전 검수 UI 먼저 노출 금지
- 정상: 재생 + 준비된 학습 기능
- 녹화 자산 준비 중: 이 화면 대신 레슨 상세의 처리 상태로 안내
- 부분 준비·부분 실패: 준비된 영역만 활성화, 영상 재생은 AI 실패와 무관하게 유지
- 재생 실패: URL 만료 vs 로딩 실패 구분, 재시도 또는 레슨 상세로 복귀
- 빈 상태: 채팅 없음 / 북마크 없음(첫 북마크 안내) / 퀴즈 없음·준비 중 / AI Q&A 기록 없음

## 다음 화면
헤더/타임라인 이동 → 같은 화면 내 시점 이동 · "레슨 상세로" → 07_lesson-detail · 이전/다음 레슨 → 07_lesson-detail(다른 lessonId)
