# LiveClass AI — 커리큘럼 폼 컴포넌트

> 컴포넌트 원칙: [README.md](README.md) · 공통 레이아웃: [COMMON.md](COMMON.md) · 페이지 기준: [PAGES.md](../PAGES.md)

## 1. 목적

`CurriculumForm`은 커리큘럼 생성 페이지와 커리큘럼 관리 페이지의 기본 정보 수정 영역에서 공유하는 폼이다.

```text
CurriculumCreatePage
└─ CurriculumForm(mode="create")

CurriculumManagementPage
└─ CurriculumInfoPanel
   └─ CurriculumForm(mode="edit")
```

커리큘럼 기본 정보만 담당하며 섹션·레슨 편성과 강의 자료 업로드는 담당하지 않는다. 강의 자료는 특정 레슨에 귀속된다.

## 2. 컴포넌트 트리

```text
CurriculumForm
├─ CurriculumBasicFields
│  ├─ CurriculumTitleField
│  ├─ CurriculumSummaryField
│  └─ CurriculumDescriptionField
├─ CurriculumThumbnailField
├─ CurriculumPeriodFields
├─ CurriculumVisibilityFields
├─ CurriculumEnrollmentPolicyFields
├─ CurriculumFormError
└─ CurriculumFormActions
```

정책이 확정되지 않은 필드는 구현 전까지 만들지 않는다.

## 3. 컴포넌트 책임

| 컴포넌트 | 책임 |
|---|---|
| `CurriculumForm` | 폼 입력·검증·제출 상태 조합 |
| `CurriculumBasicFields` | 제목·요약·상세 소개 입력 조합 |
| `CurriculumThumbnailField` | 대표 이미지 선택·미리보기·교체 |
| `CurriculumPeriodFields` | 전체 진행 시작·종료 기간 입력 |
| `CurriculumVisibilityFields` | 공개 범위가 확정되면 관련 입력 제공 |
| `CurriculumEnrollmentPolicyFields` | 수강 신청 정책이 확정되면 관련 입력 제공 |
| `CurriculumFormError` | 필드 외 제출 오류 안내 |
| `CurriculumFormActions` | 생성·저장·취소 행동 제공 |

모든 컴포넌트는 `features/curriculum`이 소유하고 생성·관리 page에서 조합한다.

## 4. 생성·수정 모드 차이

| 구분 | 생성 | 수정 |
|---|---|---|
| 초기값 | 기본값 | 기존 커리큘럼 정보 |
| 대표 행동 | 커리큘럼 생성 | 변경사항 저장 |
| 완료 후 이동 | 상세 또는 관리 | 관리 페이지 유지 또는 상세 |
| 권한 | 강사 계정 | 해당 커리큘럼 강사 |
| 취소 | 이전 페이지 | 변경 취소 또는 관리 화면 복귀 |

폼 UI를 모드별로 복제하지 않는다. 단, 수정 모드에서만 필요한 위험 행동은 `CurriculumForm`에 섞지 않고 관리 페이지의 별도 영역에 둔다.

## 5. 입력과 검증 범위

초기 필수 후보:

- 제목
- 짧은 소개
- 상세 설명
- 대표 이미지
- 전체 진행 기간

정책 확정 후 추가할 후보:

- 공개·비공개
- 즉시 수강·승인·초대 방식
- 모집 기간
- 수강 정원

정확한 길이·파일 크기·날짜 규칙은 API 계약과 함께 확정한다.

## 6. 대표 이미지 처리

`CurriculumThumbnailField`는 다음 상태를 구분한다.

- 파일 미선택
- 로컬 미리보기
- 파일 검증 실패
- 업로드 또는 저장 중
- 기존 이미지 표시
- 새 이미지로 교체 예정
- 이미지 제거 예정

클라이언트 미리보기 URL은 컴포넌트가 해제하고, 실제 저장 위치를 프론트가 구성하지 않는다.

## 7. 폼 상태

- 초기 데이터 로딩: 수정 모드만
- 기본 입력
- 클라이언트 검증 오류
- 제출 중
- 제출 실패
- 제출 성공
- 저장되지 않은 변경사항 존재

제출 중에는 중복 제출을 막는다. 수정 중 페이지를 벗어나면 저장되지 않은 변경사항을 안내한다.

## 8. 강의 자료와의 경계

커리큘럼은 여러 섹션과 레슨을 포함하고, PPTX 강의 자료는 특정 레슨의 학습·자막·AI 근거에 사용된다. 따라서 `CurriculumForm`에는 강의 자료 업로드를 넣지 않는다.

```text
Curriculum
└─ Section
   └─ Lesson
      └─ Material / MaterialVersion
```

- 커리큘럼 대표 이미지는 `CurriculumThumbnailField`가 담당
- 레슨 PPTX 자료는 레슨 생성·수정의 `LessonMaterialSection`이 담당
- 커리큘럼 관리에서는 각 레슨의 자료 등록·처리 상태만 요약 표시
- 레슨당 등록 가능한 PPTX 개수는 제한하지 않음
- 초기 자료는 레슨 생성에서 한 번에 복수 업로드하고 이후에는 한 파일씩 즉시 추가·삭제
- 추가 자료만 증분 임베딩하고 삭제 자료의 chunk·embedding과 영향받은 AI 결과만 처리

세부 자료 흐름은 [LESSON_FORM.md](LESSON_FORM.md)를 따른다.

## 9. 필요한 데이터

- 생성 또는 수정 모드
- 수정 모드의 기존 커리큘럼 기본 정보
- 현재 사용자에게 허용된 저장 행동
- 입력 검증 및 제출 결과

실제 필드와 요청·응답은 [API_MAP.md](../API_MAP.md)에서 확정한다.

## 10. 미확정 사항

1. 필수 입력과 최대 길이
2. 대표 이미지 형식·크기·비율
3. 커리큘럼 공개 범위
4. 수강 신청 방식
5. 모집 기간과 전체 진행 기간을 분리할지
6. 수정 모드 저장 후 현재 화면 유지 여부
7. 커리큘럼 삭제·종료 기능의 위치와 정책
