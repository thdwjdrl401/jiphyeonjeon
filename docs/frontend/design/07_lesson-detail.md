# 레슨 상세

> 원본: [../components/LESSON_DETAIL.md](../components/LESSON_DETAIL.md) · 로드맵: [00_ROADMAP.md](00_ROADMAP.md)

| 라우트 | 레이아웃 | 접근 |
|---|---|---|
| `/curriculums/:curriculumId/sections/:sectionId/lessons/:lessonId` | `WorkspaceLayout` | 강사(커리큘럼 운영자)·수강생 |

## 목적
레슨의 기본 정보·게시 상태·자료, 연결된 라이브 세션과 다시보기 상태를 한 곳에서 확인하는 허브 페이지. 일정 편집·사전 점검·라이브 시청·VOD 재생은 각각 전용 화면으로 이동해서 처리하며, 이 페이지 자체에는 플레이어를 두지 않는다.

## 화면 구성
```text
LessonDetailHeader
├─ LessonBreadcrumbs      — 커리큘럼 > 섹션 > 레슨
├─ LessonStatusBadge      — DRAFT/AI_NOT_READY/READY/PUBLISHED
└─ LessonHeaderActions    — 역할·상태별 대표 행동

LessonOverview             — 제목·설명·강사 정보

LessonReadinessSection      강사만
├─ LessonReadinessChecklist  — 필수 자료·AI·진행 중 작업 체크
├─ MaterialProcessingSummary
└─ PublishLessonAction       READY 전용

LessonMaterialSummary
└─ LessonMaterialItem[]      — (수강생: 활성 자료만 / 강사: 처리 상태 포함)

LinkedLiveSessionSection
├─ NoLiveSessionCard         — 세션 없음: "라이브 세션 만들기"(강사)
└─ LiveSessionSummaryCard    — 세션 존재: sessionId·일정·상태·입장 가능 여부

ReplayStatusSection          종료 이후
├─ VideoAssetStatusSummary   — 녹화 처리 단계
├─ ReplayPublicationSummary  — 검수 대기/공개/공개 중단
└─ AiContentStatusNotice

PreviousNextLessonNavigation — 이전/다음 레슨 이동
```

## 레슨 상태 × 역할별 대표 행동
| 레슨 상태 | 강사 | 수강생 |
|---|---|---|
| `DRAFT` | 기본 정보·초기 자료 준비, 세션 초안 생성 가능 | 접근 불가 |
| `AI_NOT_READY` | 처리 상태 확인·재시도, 세션 일정 관리 | 접근 불가 |
| `READY` | 최종 확인·게시, 세션 일정 관리 | 접근 불가 |
| `PUBLISHED` + 세션 없음 | 라이브 세션 생성 | 레슨·자료 확인 |
| `PUBLISHED` + 세션 존재 | 라이브 세션 상세/관리로 이동 | 라이브 세션 상세로 이동 |

수강생은 `PUBLISHED` 레슨만 접근 가능하다.

## 녹화·다시보기 상태 조합
| 상태 조합 | 강사 화면 | 수강생 화면 |
|---|---|---|
| 세션 종료 직후, 자산 처리 중 | 처리 현황 링크 | "다시보기 준비 중" |
| 자산 처리 실패 | 실패 원인 + 복구 동선 | "준비 실패" 안내 |
| 기존 자산 준비완료 + 미게시 | 미리보기·수동 게시 진입 | "게시 대기" |
| 자산 준비완료 + 공개됨 | 재생·게시본 관리 | "다시보기" 진입 |
| 자산 준비완료 + 공개 중단 | 미리보기·재게시 검토 | 공개 중단 안내 |

## 상태
레슨 상태가 바뀌거나 라이브가 `LIVE`가 되어도 이 상세 페이지에서는 자동으로 다른 화면으로 이동시키지
않는다. 다만 강사 종료 뒤 전용 processing 페이지는 `READY + PUBLISHED`에서 VOD로 자동 이동한다.

## 다음 화면
"레슨 수정" → 레슨 수정 · "게시" → 같은 화면 내 상태 갱신 · "라이브 세션 생성/상세" → 08_live-session · "라이브 입장" → 09_live-lesson · "다시보기" → 10_vod-lesson · Breadcrumbs → 커리큘럼 상세/관리 · 이전/다음 레슨 → 같은 화면(다른 lessonId)
