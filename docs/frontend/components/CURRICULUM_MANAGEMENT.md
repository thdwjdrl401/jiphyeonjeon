# LiveClass AI — 커리큘럼 관리 컴포넌트

> 컴포넌트 원칙: [README.md](README.md) · 커리큘럼 폼: [CURRICULUM_FORM.md](CURRICULUM_FORM.md) · 페이지 기준: [PAGES.md](../PAGES.md)

## 1. 목적

커리큘럼 관리는 해당 커리큘럼 강사가 기본 정보, 섹션·레슨 편성, 수강생 상태를 관리하는 작업 페이지다.

별도의 커리큘럼 수정 페이지를 추가하지 않는다. 기본 정보 수정은 관리 페이지 안에서 `CurriculumForm(mode="edit")`을 재사용한다.

## 2. 컴포넌트 트리

```text
CurriculumManagementPage
├─ CurriculumManagementHeader
├─ CurriculumManagementNavigation
└─ CurriculumManagementContent
   ├─ CurriculumInfoPanel
   │  └─ CurriculumForm(mode="edit")
   ├─ CurriculumStructureManager
   │  └─ SectionManager[]
   │     └─ LessonManagementItem[]
   │        └─ LessonMaterialSummary
   └─ EnrolleeManager
```

기본 정보, 편성, 수강생 관리를 한 화면에 모두 펼치지 않고 탭 또는 하위 메뉴로 구분한다. URL에 하위 상태를 반영할지는 추후 결정한다.

## 3. 접근 권한

- 해당 커리큘럼을 운영하는 강사만 접근
- 다른 강사·학생·수강생은 관리 UI를 렌더링하지 않고 진입 단계에서 차단
- 프론트엔드 라우트 가드와 별개로 서버에서 모든 관리 행동의 권한 검사 필요
- 권한 확인 중에는 관리 화면을 먼저 노출하지 않음

## 4. 상위 컴포넌트 책임

| 컴포넌트 | 소유 영역 | 책임 |
|---|---|---|
| `CurriculumManagementPage` | `pages` | 권한·조회 상태와 관리 feature 조합 |
| `CurriculumManagementHeader` | page 전용 | 커리큘럼 이름·상태·상세 이동·대표 행동 표시 |
| `CurriculumManagementNavigation` | `features/curriculum` | 기본 정보·편성·수강생 관리 전환 |
| `CurriculumManagementContent` | page 조합 | 선택된 관리 영역 표시 |
| `CurriculumInfoPanel` | `features/curriculum` | `CurriculumForm` 수정 모드와 운영 상태 조합 |
| `CurriculumStructureManager` | `features/curriculum` | 섹션·레슨 계층 편성 |
| `EnrolleeManager` | `features/enrollment` | 수강생 목록·신청·상태 관리 |

## 5. 기본 정보 관리

`CurriculumInfoPanel`은 [CURRICULUM_FORM.md](CURRICULUM_FORM.md)의 폼을 수정 모드로 사용한다.

```text
CurriculumInfoPanel
├─ CurriculumForm(mode="edit")
└─ CurriculumLifecycleActions
```

`CurriculumLifecycleActions` 후보:

- 공개 상태 변경
- 모집 시작·종료
- 커리큘럼 종료
- 커리큘럼 삭제

위 행동은 정책이 확정되기 전까지 필수 컴포넌트로 간주하지 않는다. 되돌리기 어려운 행동은 기본 정보 저장과 분리한다.

## 6. 섹션·레슨 편성

### 6.1 컴포넌트 구조

```text
CurriculumStructureManager
├─ StructureToolbar
│  └─ AddSectionButton
├─ SectionManager[]
│  ├─ SectionHeader
│  ├─ SectionActions
│  ├─ AddLessonButton
│  └─ LessonManagementItem[]
└─ StructureSaveStatus
```

### 6.2 `SectionManager`

- 섹션 제목·설명 표시 및 수정
- 섹션 생성·삭제
- 섹션 순서 변경
- 소속 레슨 목록 표시
- 섹션 안에 레슨 추가

섹션 삭제가 소속 레슨에 미치는 영향은 서버 정책이 확정되기 전까지 단순 삭제 버튼으로 구현하지 않는다.

### 6.3 `LessonManagementItem`

- 레슨 제목
- 연결 live session의 예정·진행·종료 상태
- 예정 일시
- 섹션 안의 순서
- 강의 자료 등록·처리 상태
- 레슨 수정 이동
- 정책이 허용하는 경우 삭제·순서 변경

레슨 생성·수정 폼 전체를 관리 목록 안에 중복 구현하지 않는다. `AddLessonButton`과 수정 행동은 기존 레슨 생성·수정 라우트로 연결한다.

### 6.4 순서 변경

- 섹션 순서와 섹션 내부 레슨 순서를 별도로 관리
- 드래그 앤 드롭을 도입하더라도 키보드 대체 행동 제공
- 저장 중 중복 순서 변경 방지
- 실패 시 서버 기준 순서로 복구하거나 명확한 재시도 제공

정렬 변경을 즉시 저장할지 명시적 저장 버튼을 사용할지는 추후 결정한다.

## 7. 레슨별 자료 상태

강의 자료는 레슨에 귀속되므로 커리큘럼 관리 페이지에서는 업로드·교체·버전 관리 기능을 제공하지 않는다.

`LessonMaterialSummary`는 `LessonManagementItem` 안에서 다음 상태만 요약한다.

- 자료 없음·라이브 시작 불가
- 초기 자료 업로드 대기
- 단일 자료 업로드·삭제 중
- AI 처리 중(`AI_NOT_READY`)
- 처리 완료(`READY`)
- lesson 게시 완료(`PUBLISHED`)
- 처리 실패·재시도 필요

자료 등록·수정이 필요하면 해당 레슨 수정 페이지로 이동한다. 초기 PPTX 복수 업로드와 이후 단일 자료 추가·삭제, 증분 임베딩, 영향받은 AI 결과 처리는 [LESSON_FORM.md](LESSON_FORM.md)에서 정의한다.

## 8. 수강생 관리

### 8.1 컴포넌트 구조

```text
EnrolleeManager
├─ EnrolleeSummary
├─ EnrolleeSearchControls
├─ EnrollmentRequestList
└─ EnrolleeList
```

### 8.2 책임

- 전체 수강생과 상태 요약
- 수강생 검색·필터
- 승인 방식이 채택되면 신청 승인·거절
- 수강 상태 확인
- 정책이 허용하면 수강 취소·권한 회수

즉시 수강만 지원하면 `EnrollmentRequestList`는 만들지 않는다.

## 9. 페이지 상태

### 9.1 초기 로딩

- 커리큘럼 정보와 관리 권한 확인
- 권한 확인 전 관리 콘텐츠 숨김

### 9.2 정상

- 선택한 관리 영역 표시
- 다른 영역의 조회 실패가 현재 영역을 막지 않도록 분리 가능

### 9.3 빈 상태

- 섹션 없음: 첫 섹션 생성
- 섹션 안 레슨 없음: 첫 레슨 생성
- 자료 없음: 레슨 수정에서 자료 등록
- 수강생 없음: 모집 또는 초대 정책 안내
- 승인 대기 없음: 정상 빈 상태 안내

### 9.4 저장·처리 중

- 기본 정보 저장 중
- 순서 변경 저장 중
- 수강 상태 변경 중

서로 다른 작업을 하나의 전역 로딩으로 묶지 않는다.

### 9.5 실패

- 커리큘럼 조회 실패
- 권한 부족
- 기본 정보 저장 실패
- 편성 저장 실패
- 수강 상태 변경 실패

실패한 영역 가까이에 재시도 또는 복구 행동을 제공한다.

## 10. 주요 사용자 행동

- 커리큘럼 기본 정보 저장
- 커리큘럼 상세로 이동
- 섹션 생성·수정·삭제·순서 변경
- 레슨 생성·수정·삭제·순서 변경
- 레슨별 강의 자료 상태 확인
- 자료 등록·수정을 위해 레슨 수정으로 이동
- 수강 신청 승인·거절
- 수강생 검색·상태 변경

## 11. 필요한 데이터

실제 필드와 API는 [API_MAP.md](../API_MAP.md)에서 확정한다.

- 커리큘럼 기본 정보와 운영 상태
- 현재 사용자의 관리 권한
- 섹션·레슨 계층과 순서
- lesson 상태와 연결 live session의 `sessionId`·일정·상태
- 레슨별 자료 등록·처리 상태 요약
- 수강생과 수강 신청 상태
- 각 관리 행동의 허용 여부

## 12. 미확정 사항

1. 관리 영역을 탭, 하위 라우트, 한 페이지 섹션 중 무엇으로 구성할지
2. 섹션·레슨 순서 변경 저장 방식
3. 진행·종료된 레슨의 수정·삭제 허용 범위
4. 커리큘럼 종료·삭제 정책
5. 수강 신청 방식과 수강생 상태 종류
6. 자료 처리 상태를 목록에서 자동 갱신할지 수동 새로고침할지
7. 커리큘럼 통계를 관리 페이지에 포함할지 별도 페이지로 분리할지

## 13. 이후 확인할 기능 후보

- 커리큘럼 공지 관리
- 수강생 일괄 초대
- 섹션·레슨 복제
- 커리큘럼 미리보기
- 커리큘럼 학습 통계

후보 기능은 채택되기 전까지 필수 컴포넌트나 API로 간주하지 않는다.
