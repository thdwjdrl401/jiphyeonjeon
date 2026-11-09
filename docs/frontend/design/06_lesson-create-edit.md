# 레슨 생성 · 레슨 수정

> 원본: [../components/LESSON_FORM.md](../components/LESSON_FORM.md) · 로드맵: [00_ROADMAP.md](00_ROADMAP.md)

| 화면 | 라우트 | 레이아웃 | 접근 |
|---|---|---|---|
| 레슨 생성 | `/instructor/curriculums/:curriculumId/sections/:sectionId/lessons/new` | `WorkspaceLayout` | 해당 커리큘럼 강사 |
| 레슨 수정 | `/instructor/curriculums/:curriculumId/sections/:sectionId/lessons/:lessonId/edit` | `WorkspaceLayout` | 해당 커리큘럼 강사 |

같은 `LessonForm`을 공유한다. 생성 페이지에서 기본 정보를 저장하면 같은 화면 안에서 곧바로 "초기 자료 준비" 단계로 전환되고(새 라우트로 넘어가지 않음), 이후 흐름은 수정 화면과 같다.

## 목적
강사가 레슨 제목/설명과 PPTX 강의 자료를 준비하고 게시하는 화면. 레슨은 모두 라이브로 진행되므로 영상 업로드나 레슨 유형 선택 UI는 없다. 라이브 일정 자체는 별도 화면([08_live-session.md](08_live-session.md))에서 다룬다.

## 화면 구성
```text
LessonFormHeader
├─ LessonParentContext        — 상위 커리큘럼·섹션(읽기 전용)
├─ LessonPreparationStatus    — DRAFT / AI_NOT_READY / READY / PUBLISHED 배지 + 현재 작업
└─ LessonFormNavigation

LessonForm
├─ LessonBasicFields
│  ├─ LessonTitleField (필수)
│  └─ LessonDescriptionField (선택)
├─ LessonMaterialSection
│  ├─ [초기 준비, 자료가 아직 없을 때] InitialMaterialSetup
│  │  ├─ InitialMaterialPicker          — PPTX 복수 선택
│  │  ├─ InitialMaterialUploadQueue     — 파일별 업로드 진행/성공/실패
│  │  └─ StartInitialAiPreparation      — 강사가 명시적으로 AI 준비 시작
│  └─ [초기 준비 이후] IncrementalMaterialManager
│     ├─ ActiveMaterialList → LessonMaterialItem[]  — 파일명·크기·순서·상태·다운로드·삭제
│     ├─ SingleMaterialUploader          — 한 번에 파일 1개 추가
│     ├─ MaterialDeleteConfirm           — 삭제 확인(영향 안내 포함)
│     └─ MaterialImpactNotice            — 근거·AI 산출물에 미치는 영향 안내
├─ LessonProcessingPanel
│  ├─ CurrentMaterialOperation  — 현재 진행 중인 업로드/임베딩/삭제 작업
│  ├─ AiPreparationProgress
│  └─ MaterialOperationError
├─ LessonFormError
├─ UnsavedChangesNotice
└─ LessonFormActions
   ├─ SaveLessonInfoAction
   ├─ SaveDraftAction        생성 전용
   ├─ PublishLessonAction    READY 전용
   └─ CancelAction
```

## 레슨 상태별 화면 잠금
| 레슨 상태 | 제목·설명 | 자료 |
|---|---|---|
| `DRAFT` | 수정 가능 | 초기 복수 업로드 또는 단일 변경 |
| `AI_NOT_READY` | 수정 가능 | 현재 작업 완료 후 단일 변경 |
| `READY` | 수정 가능 | 단일 추가·삭제 |
| `PUBLISHED` + 세션 시작 전 | 수정 가능 | 변경 시 `AI_NOT_READY`로 되돌아가고 재게시 필요 |
| 연결 세션 `LIVE` | 전체 읽기 전용 | 전체 잠금 |
| 연결 세션 `ENDED` | 제목·설명만 수정 | 잠금(자료 변경은 후속 범위) |

## 생성 흐름 (화면 전환 없이 같은 페이지 안에서 단계만 전환)
1. 제목 입력 → "초안 저장" → `DRAFT` 생성, 같은 화면에서 자료 준비 단계로 전환
2. PPTX 여러 개 선택 → 파일별 업로드 진행/실패 표시 → 실패 파일만 재시도/제거
3. 강사가 "초기 AI 준비 시작" 클릭 → `AI_NOT_READY` 표시
4. 전체 초기 자료 처리 완료 → `READY`
5. 강사가 최종 확인 후 게시 → `PUBLISHED`

## 이후 자료 추가/삭제 (수정 화면, 초기 준비 이후)
- 추가: 파일 1개 선택 → 업로드 → 처리 완료까지 다른 자료 작업 일시 제한 → 완료 시 공개 목록에 반영
- 삭제: 파일 1개 선택 → 영향 확인 다이얼로그 → 삭제 진행 표시 → 완료
- 새 자료를 먼저 추가·완료한 뒤 기존 자료를 삭제하는 순서를 안내(교체 시)
- 게시된 레슨의 자료를 바꾸면 일시적으로 `AI_NOT_READY`로 돌아가고, 재게시해야 다시 `PUBLISHED`

## 상태
- 초기 로딩: 권한 확인 전 편집 가능 상태 노출 금지
- `DRAFT`: 자료 없어도 정상, 초기 준비 유도
- 업로드·처리 중: 파일/작업 단위 진행 표시, 다른 자료 변경 일시 제한
- 실패: 기본 정보 저장 실패 / 파일 업로드·검증 실패 / 파싱·임베딩 실패 / 삭제 실패 / AI 산출물 처리 실패 — 실패 단계 근처에 재시도, 기존 정상 자료는 그대로 유지
- `READY`: 게시 가능 상태 + 최종 확인 CTA
- `PUBLISHED`: 공개 중 상태 표시 + 라이브 세션으로 이동 유도
- 잠금 상태: `LIVE`(전체 읽기전용 + 라이브 레슨 이동 링크), `ENDED`(제목/설명만 + VOD 이동 링크)

## 다음 화면
게시 완료/기존 레슨 → 레슨 상세 · "커리큘럼 관리로 이동" → 커리큘럼 관리 · 잠금 상태 안내 링크 → 라이브 레슨 / VOD 레슨
