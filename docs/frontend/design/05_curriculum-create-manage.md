# 커리큘럼 생성 · 커리큘럼 관리

> 원본: [../components/CURRICULUM_FORM.md](../components/CURRICULUM_FORM.md), [../components/CURRICULUM_MANAGEMENT.md](../components/CURRICULUM_MANAGEMENT.md) · 로드맵: [00_ROADMAP.md](00_ROADMAP.md)

| 화면 | 라우트 | 레이아웃 | 접근 |
|---|---|---|---|
| 커리큘럼 생성 | `/curriculums/new` | `WorkspaceLayout` | 강사 계정 |
| 커리큘럼 관리 | `/curriculums/:curriculumId/manage` | `WorkspaceLayout` | 해당 커리큘럼 강사만 |

두 화면은 같은 기본 정보 폼(`CurriculumForm`)을 생성/수정 모드로 공유한다.

---

## 1. 커리큘럼 생성 (`/curriculums/new`)

### 화면 구성
```text
CurriculumForm(mode="create")
├─ CurriculumBasicFields
│  ├─ CurriculumTitleField
│  ├─ CurriculumSummaryField
│  └─ CurriculumDescriptionField
├─ CurriculumThumbnailField    — 대표 이미지 선택·미리보기
├─ CurriculumPeriodFields      — 전체 진행 기간
├─ CurriculumVisibilityFields         (확정 시)
├─ CurriculumEnrollmentPolicyFields   (확정 시)
├─ CurriculumFormError
└─ CurriculumFormActions       — 생성 / 취소
```

### 대표 이미지 상태
파일 미선택 → 로컬 미리보기 → (검증 실패 시 오류) → 업로드/저장 중 → 저장 완료

### 상태
기본 입력 / 클라이언트 검증 오류 / 제출 중(중복 제출 방지) / 제출 실패 / 제출 성공 / 저장되지 않은 변경사항 존재(이탈 시 경고)

### 다음 화면
생성 완료 → 커리큘럼 상세 또는 커리큘럼 관리 · 취소 → 이전 화면(내 커리큘럼)

---

## 2. 커리큘럼 관리 (`/curriculums/:curriculumId/manage`)

### 목적
해당 커리큘럼 강사가 기본 정보·섹션/레슨 편성·수강생 상태를 관리하는 작업 화면. 별도 "커리큘럼 수정" 페이지는 없고, 이 화면 안에서 기본 정보 폼을 수정 모드로 재사용한다.

### 화면 구성
```text
CurriculumManagementHeader        — 커리큘럼 이름·상태·상세 이동·대표 행동
CurriculumManagementNavigation    — 기본 정보 / 편성 / 수강생 관리 탭 전환
CurriculumManagementContent
├─ [탭: 기본 정보] CurriculumInfoPanel
│  ├─ CurriculumForm(mode="edit")
│  └─ CurriculumLifecycleActions   — 공개 상태 변경·모집 시작/종료·종료·삭제(위험 행동, 확정 정책 필요)
├─ [탭: 편성] CurriculumStructureManager
│  ├─ StructureToolbar → AddSectionButton
│  └─ SectionManager[]
│     ├─ SectionHeader (제목·설명·순서, 접기/펼치기)
│     ├─ SectionActions (수정·삭제·순서 변경)
│     ├─ AddLessonButton
│     └─ LessonManagementItem[]
│        └─ LessonMaterialSummary  — 자료 등록/처리 상태 요약(업로드 자체는 여기서 안 함)
└─ [탭: 수강생] EnrolleeManager
   ├─ EnrolleeSummary
   ├─ EnrolleeSearchControls
   ├─ EnrollmentRequestList        — 승인 방식 채택 시만
   └─ EnrolleeList
```

세 영역을 한 화면에 모두 펼치지 않고 탭(또는 하위 메뉴)으로 구분한다.

### `LessonManagementItem` 표시
제목 · 연결 라이브 세션 상태(예정/진행/종료) · 예정 일시 · 섹션 내 순서 · 자료 상태(없음/업로드 대기/처리 중/완료/게시됨/실패) · 수정 이동 · (허용 시) 삭제·순서 변경

레슨 생성/수정 폼 전체를 이 목록 안에 넣지 않고 전용 화면으로 이동시킨다.

### `LessonMaterialSummary` 상태값
자료 없음(라이브 시작 불가) / 초기 업로드 대기 / 업로드·삭제 중 / AI 처리 중 / 처리 완료 / 게시 완료 / 처리 실패

### 상태
- 초기 로딩: 권한 확인 전 관리 콘텐츠 숨김
- 빈 상태: 섹션 없음(첫 섹션 생성) / 섹션 안 레슨 없음(첫 레슨 생성) / 수강생 없음
- 저장·처리 중: 기본 정보 저장, 순서 변경, 수강 상태 변경을 각각 독립 표시(전역 로딩으로 묶지 않음)
- 실패: 조회 실패 / 권한 부족 / 기본 정보 저장 실패 / 편성 저장 실패 / 수강 상태 변경 실패 — 실패한 영역 근처에 재시도

### 다음 화면
"커리큘럼 상세로 이동" → 커리큘럼 상세 · "레슨 생성" → 레슨 생성 · "레슨 수정" → 레슨 수정 · 레슨 항목 클릭 → 레슨 상세
