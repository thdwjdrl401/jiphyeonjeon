# LiveClass AI — 레슨 생성·수정 공통 폼 컴포넌트

> 컴포넌트 원칙: [README.md](README.md) · 커리큘럼 관리: [CURRICULUM_MANAGEMENT.md](CURRICULUM_MANAGEMENT.md) · 페이지 기준: [PAGES.md](../PAGES.md)

## 1. 목적

레슨 생성·수정은 해당 커리큘럼 강사가 특정 섹션에 레슨 기본 정보와 PPTX 자료를 준비하고 게시하는 작업 페이지다.

- 생성: 기본 정보를 먼저 저장해 `DRAFT`를 만들고 초기 PPTX를 복수 선택해 준비
- 수정: 기본 정보는 독립적으로 저장하고, 준비된 자료는 한 파일씩 추가하거나 삭제

두 페이지는 같은 `LessonForm`을 사용하고 라우트와 모드만 구분한다. 레슨은 모두 라이브로 진행되므로 영상 업로드와 레슨 유형 선택은 제공하지 않는다.

라이브 일정은 lesson 필드가 아니라 별도 `liveSession`에서 관리하며 [LIVE_SESSION.md](LIVE_SESSION.md)를 따른다.

## 2. 확정 원칙

- 해당 커리큘럼을 운영하는 강사만 접근
- 특정 섹션 안에서 레슨 생성
- 제목만 있어도 `DRAFT` 임시저장 가능
- 초기 자료는 필요한 PPTX를 한 번에 복수 선택·업로드
- PPTX가 하나 이상 준비되어야 AI 준비 시작 가능
- 레슨당 PPTX 개수 제한 없음
- 초기 준비 이후에는 자료 한 개씩 즉시 추가·삭제
- 이후 자료 변경에 별도의 `자료 변경 적용` 단계 없음
- 삭제 시 해당 자료의 chunk·embedding만 Vector DB에서 제거
- 추가 시 해당 자료만 파싱·chunk·embedding하여 기존 Vector DB에 추가
- 영향받은 AI 근거와 산출물만 무효화·재생성하고 관계없는 결과는 유지
- 자료 작업 중에는 라이브 시작을 차단
- `READY`에서 강사가 게시해야 `PUBLISHED`가 됨
- `PUBLISHED`와 AI 준비 완료를 모두 만족해야 연결된 라이브 세션 시작 가능
- 라이브 진행 중에는 레슨 폼을 잠금
- 종료된 레슨은 초기 범위에서 제목·설명만 수정하고 자료 변경은 후속 기능
- AI 사용 여부는 초기 폼에서 선택하지 않고 기본 활성화

## 3. 컴포넌트 트리

```text
LessonCreatePage | LessonEditPage
└─ WorkspaceLayout
   ├─ LessonFormHeader
   │  ├─ LessonParentContext
   │  ├─ LessonPreparationStatus
   │  └─ LessonFormNavigation
   └─ LessonForm
      ├─ LessonBasicFields
      │  ├─ LessonTitleField
      │  └─ LessonDescriptionField
      ├─ LessonMaterialSection
      │  ├─ InitialMaterialSetup             초기 준비
      │  │  ├─ InitialMaterialPicker
      │  │  ├─ InitialMaterialUploadQueue
      │  │  └─ StartInitialAiPreparation
      │  └─ IncrementalMaterialManager       초기 준비 이후
      │     ├─ ActiveMaterialList
      │     │  └─ LessonMaterialItem[]
      │     ├─ SingleMaterialUploader
      │     ├─ MaterialDeleteConfirm
      │     └─ MaterialImpactNotice
      ├─ LessonProcessingPanel
      │  ├─ CurrentMaterialOperation
      │  ├─ AiPreparationProgress
      │  └─ MaterialOperationError
      ├─ LessonFormError
      ├─ UnsavedChangesNotice
      └─ LessonFormActions
         ├─ SaveLessonInfoAction
         ├─ SaveDraftAction                  생성 전용
         ├─ PublishLessonAction              READY 전용
         └─ CancelAction
```

생성 페이지에서 기본 정보 저장으로 `lessonId`가 만들어지면 같은 화면에서 초기 자료 준비 단계로 전환한다. 별도의 새 라우트를 추가하지 않는다.

## 4. 컴포넌트 책임

### 4.1 페이지와 폼

| 컴포넌트 | 소유 영역 | 책임 |
|---|---|---|
| `LessonCreatePage` | `pages` | 생성 권한·상위 정보 확인, `DRAFT` 생성과 생성 단계 조합 |
| `LessonEditPage` | `pages` | 수정 권한·레슨 상태 확인, 기존 데이터와 허용 행동 조합 |
| `LessonForm` | `features/lesson` | 생성·수정 모드의 입력·검증·저장 상태 조합 |
| `LessonFormHeader` | page 전용 | 상위 계층, 레슨 준비 상태, 복귀 동선 표시 |
| `LessonParentContext` | `features/lesson` | 커리큘럼·섹션 정보를 읽기 전용으로 표시 |
| `LessonPreparationStatus` | `features/lesson` | `DRAFT`·`AI_NOT_READY`·`READY`·`PUBLISHED`와 현재 작업 표시 |
| `LessonFormActions` | `features/lesson` | 모드와 상태에 맞는 저장·취소 행동 제공 |
| `PublishLessonAction` | `features/lesson` | `READY` 레슨의 최종 조건 확인 후 `PUBLISHED` 전환 |

### 4.2 입력

| 컴포넌트 | 소유 영역 | 책임 |
|---|---|---|
| `LessonBasicFields` | `features/lesson` | 제목·설명 입력 조합 |
| `LessonTitleField` | `features/lesson` | 필수 제목 입력과 오류 표시 |
| `LessonDescriptionField` | `features/lesson` | 선택 설명 입력 |

### 4.3 자료

| 컴포넌트 | 소유 영역 | 책임 |
|---|---|---|
| `LessonMaterialSection` | `features/lesson-material` | 초기 준비 또는 증분 관리 화면 선택 |
| `InitialMaterialSetup` | `features/lesson-material` | 초기 복수 자료 선택·업로드·AI 준비 시작 조합 |
| `InitialMaterialUploadQueue` | `features/lesson-material` | 파일별 업로드 진행·성공·실패·재시도 표시 |
| `IncrementalMaterialManager` | `features/lesson-material` | 초기 준비 이후 단일 자료 추가·삭제 조합 |
| `ActiveMaterialList` | `features/lesson-material` | 현재 활성 자료와 작업 상태 목록 표시 |
| `LessonMaterialItem` | `features/lesson-material` | 파일명·크기·순서·처리 상태·다운로드·삭제 행동 표시 |
| `SingleMaterialUploader` | `features/lesson-material` | PPTX 한 개 선택·업로드·증분 처리 시작 |
| `MaterialDeleteConfirm` | `features/lesson-material` | 삭제 대상과 AI 영향 확인 후 단일 삭제 실행 |
| `MaterialImpactNotice` | `features/lesson-material` | 근거·AI 산출물에 미치는 영향 안내 |

### 4.4 처리 상태

| 컴포넌트 | 소유 영역 | 책임 |
|---|---|---|
| `LessonProcessingPanel` | `features/lesson-material` | 현재 자료 작업과 AI 준비 상태 조합 |
| `CurrentMaterialOperation` | `features/lesson-material` | 업로드·임베딩·삭제 중인 한 작업 표시 |
| `AiPreparationProgress` | `features/ai` | 초기 또는 영향 범위 AI 처리 상태 표시 |
| `MaterialOperationError` | `features/lesson-material` | 실패 단계·영향·재시도 행동 표시 |

## 5. 접근 권한과 상태별 수정 범위

### 5.1 접근 권한

- 해당 커리큘럼을 운영하는 강사만 접근
- 다른 강사·학생·수강생은 폼을 렌더링하지 않고 라우트 진입 단계에서 차단
- 프론트 라우트 가드와 별개로 서버에서 생성·수정·자료 작업 권한 검사
- 권한과 레슨 상태 확인 전 기존 정보를 편집 가능 상태로 노출하지 않음

### 5.2 상태별 허용 범위

| lesson 상태 | 제목·설명 | 자료 |
|---|---|---|
| `DRAFT` | 수정 가능 | 초기 복수 업로드 또는 단일 변경 가능 |
| `AI_NOT_READY` | 수정 가능 | 현재 작업 완료 후 단일 변경 가능 |
| `READY` | 수정 가능 | 단일 추가·삭제 가능 |
| `PUBLISHED` + 세션 시작 전 | 수정 가능 | 변경 시 `AI_NOT_READY`로 역전이 후 재게시 필요 |
| 연결 세션 `LIVE` | 잠금 | 잠금 |
| 연결 세션 `ENDED` | 수정 가능 | 잠금 |

종료 상태에서 자료를 바꾸는 기능은 후속 범위다. 도입 시 VOD 근거·AI Q&A·게시본·퀴즈 응시 기록을 보존하는 자료 revision 정책을 먼저 정의한다.

## 6. 입력과 검증

### 6.1 기본 정보

- 레슨 제목: `DRAFT` 저장에 필요한 최소 필수값
- 레슨 설명: 선택
- 커리큘럼·섹션: 라우트와 서버 응답 기준 읽기 전용
- 섹션 내 순서: 생성 시 마지막에 자동 추가

레슨 순서와 소속 섹션 이동은 커리큘럼 관리에서 수행한다.

### 6.2 자료

- `.pptx`만 허용
- 개수 제한 없음
- 파일별 크기 제한은 API 계약을 따름
- 초기 준비는 복수 선택 가능
- 초기 준비 이후 추가는 한 번에 파일 하나만 선택
- 같은 레슨에서 동일 파일을 중복 선택한 경우 명확한 확인 또는 차단
- 실제 형식·손상 여부는 서버 검증 결과를 표시

## 7. 생성 흐름

### 7.1 기본 정보로 `DRAFT` 생성

1. 상위 커리큘럼·섹션 확인
2. 제목과 선택 정보를 입력
3. `초안 저장` 실행
4. 서버에서 레슨과 `lessonId` 생성
5. 같은 페이지에서 초기 자료 준비 단계로 전환

PPTX가 없어도 이 단계까지 완료할 수 있다. 생성된 초안은 커리큘럼 관리에서 다시 진입할 수 있어야 한다.

### 7.2 초기 자료 준비

1. 필요한 PPTX를 한 번에 복수 선택
2. 선택 목록과 파일별 검증 결과 확인
3. 각 파일 업로드
4. 실패한 파일만 재시도 또는 목록에서 제거
5. 준비할 초기 자료 집합 확인
6. 강사가 명시적으로 초기 AI 준비 시작
7. `AI_NOT_READY` 상태 표시
8. 전체 초기 자료 처리가 완료되면 `READY`

초기 AI 준비 시작 전까지 선택 목록을 조정할 수 있다. 시작 후에는 현재 작업이 끝날 때까지 추가 자료 작업을 제한한다.

### 7.3 중간 이탈

- 기본 정보 저장 전 이탈: 저장되지 않은 변경 안내
- `DRAFT` 생성 후 이탈: 초안 보존
- 업로드 중 이탈: 진행 중 작업 안내, 서버 작업은 계속될 수 있음
- 재진입: 서버의 파일별 업로드·처리 상태 복원

## 8. 기본 정보 수정

- 제목·설명 저장은 자료 작업과 분리
- 기본 정보만 바꾸면 임베딩과 AI 재처리를 실행하지 않음
- 저장 중 중복 제출 방지
- 저장 실패 시 입력값 유지와 재시도 제공
- 자료 작업 중에도 서버 정책이 허용하면 기본 정보 저장 가능
- `LIVE`에서는 폼 전체를 읽기 전용으로 전환
- `ENDED`에서는 제목·설명만 저장 가능

## 9. 초기 자료 업로드

```text
PPTX 복수 선택
   ├─ 파일 A 업로드
   ├─ 파일 B 업로드
   └─ 파일 C 업로드
          ↓
전체 초기 자료 확인
          ↓
초기 파싱·chunk·embedding
          ↓
READY
```

- 초기 파일은 한 화면에서 함께 선택
- 업로드·검증 상태는 파일별 표시
- 일부 실패가 전체 성공처럼 보이지 않도록 구분
- 실패 파일 재시도 후 초기 AI 준비 가능
- 초기 AI 준비가 시작되면 레슨을 `AI_NOT_READY`로 표시
- 처리 실패 시 성공한 자료 상태를 보존하고 실패 단계 재시도 제공

## 10. 이후 자료 추가

초기 준비 이후에는 자료 하나를 선택하고 즉시 처리한다.

```text
PPTX 한 개 선택
   ↓
업로드
   ↓
파싱·chunk 생성
   ↓
해당 chunk embedding
   ↓
기존 Vector DB에 추가
```

- 업로드가 시작되면 다른 자료 추가·삭제를 일시적으로 제한
- 기존 자료의 chunk·embedding은 다시 생성하지 않음
- 새 자료와 직접 관련된 AI 후보·근거만 생성 또는 갱신
- 성공 후 새 자료를 수강생 공개 목록과 AI 검색 범위에 포함
- 실패하면 기존 활성 자료와 Vector DB를 유지
- 실패한 파일에 재시도 또는 제거 제공

## 11. 이후 자료 삭제

자료 하나를 선택하고 확인 후 즉시 삭제 작업을 시작한다.

```text
자료 하나 선택
   ↓
영향 확인·삭제 승인
   ↓
해당 materialId의 chunk·embedding 제거
   ↓
자료 파일·메타데이터 제거
   ↓
영향받은 AI 근거·산출물 처리
```

- 여러 자료 일괄 선택·삭제는 초기 범위에서 제외
- 삭제 중에는 대상 자료에 `삭제 중` 상태 표시
- 삭제가 완료되기 전까지 다른 자료 작업 제한
- 삭제된 자료를 직접 참조하는 근거는 비활성화
- 영향을 받은 AI 답변은 `근거 변경됨` 상태로 전환
- 자동 산출물은 현재 Vector DB 기준으로 영향 범위만 재생성
- 관계없는 자료·embedding·AI 산출물은 유지
- 실패 시 대상 자료 상태를 복구하거나 재시도 제공

## 12. 자료 교체

별도 교체 API나 일괄 적용 UI를 만들지 않는다.

```text
새 자료 한 개 추가·처리 완료
        ↓
기존 자료 한 개 삭제
```

새 자료를 먼저 준비한 뒤 기존 자료를 삭제하는 순서를 안내한다. 이렇게 하면 수강생 공개 자료와 AI 검색 근거가 완전히 사라지는 시간을 줄일 수 있다.

## 13. 자료 변경과 AI 영향

### 13.1 증분 처리

- 자료별 `materialId`와 chunk·embedding 계보 유지
- 추가는 새 자료 계보만 생성
- 삭제는 대상 자료 계보만 제거
- 자료 순서 변경은 표시 메타데이터만 바꾸고 임베딩을 다시 만들지 않음
- 전체 Vector DB를 비우거나 전체 자료를 다시 임베딩하지 않음
- 한 자료 작업이 끝나기 전 다음 자료 작업을 시작하지 않는 것을 기본으로 함

### 13.2 기존 AI 결과

- 삭제된 자료를 직접 인용한 근거는 즉시 사용할 수 없도록 표시
- 해당 근거를 사용하는 기존 AI 답변은 `근거 변경됨` 상태로 전환
- 사용자가 다시 확인할 때 현재 Vector DB 기준 재생성을 요청할 수 있음
- 자동 생성된 용어·노트·퀴즈 후보는 영향받은 항목만 무효화·재생성
- 새 자료 업로드는 새 자료를 기반으로 필요한 후보를 추가
- 관계없는 기존 AI 결과와 강사 검수 결과는 유지

현재 범위에서는 라이브 시작 후 자료가 잠기므로 VOD 게시본과 완료된 퀴즈 응시 기록을 자료 변경으로 다시 쓰지 않는다.

`PUBLISHED` 레슨의 자료를 추가·삭제하면 서버가 lesson 상태를 `AI_NOT_READY`로 되돌린다. 연결된 live session 일정은 유지하지만 시작은 차단한다. 영향 범위 처리가 끝나 `READY`가 되면 강사가 변경 내용을 확인하고 다시 게시해야 한다.

## 14. 준비·게시 상태와 라이브 세션

| 상황 | lesson 상태 | 게시 | live session 시작 |
|---|---|---|---|
| 기본 정보만 존재 | `DRAFT` | 불가 | 불가 |
| 초기 업로드 목록 준비 중 | `DRAFT` | 불가 | 불가 |
| 초기 AI 처리 중 | `AI_NOT_READY` | 불가 | 불가 |
| 단일 자료 추가·삭제 처리 중 | `AI_NOT_READY` | 불가 | 불가 |
| 자료 작업 실패 | `AI_NOT_READY` 또는 실패 세부 상태 | 불가 | 불가 |
| 필요한 자료와 AI 처리 완료 | `READY` | 가능 | 불가 |
| 강사 게시 완료 | `PUBLISHED` | 완료 | 별도 세션 조건 충족 시 가능 |

기존의 정상 자료와 AI 기능은 증분 작업 중에도 가능한 범위에서 유지하되, 현재 변경 자료와 연관된 영역에는 업데이트 중 또는 근거 변경 상태를 표시한다.

## 15. 게시와 공개 범위

- 레슨 공개 여부는 별도 boolean이 아니라 `status=PUBLISHED`로 관리
- `DRAFT`·`AI_NOT_READY`·`READY`는 강사만 접근
- `READY`에서 게시 조건과 활성 PPTX를 최종 확인한 뒤 명시적으로 게시
- `PUBLISHED`에서 수강생에게 레슨 기본 정보와 활성 PPTX 자료 표시
- 자료 변경으로 `AI_NOT_READY`가 되면 기존 공개를 일시 중단하고 재게시 필요 상태 표시
- 새 자료는 재게시 후 수강생 공개 목록과 AI 검색 범위에 포함
- 삭제 자료는 재게시 후 수강생 목록에서 제거

## 16. 페이지 상태

### 16.1 초기 로딩

- 상위 커리큘럼·섹션과 관리 권한 확인
- 수정 모드는 레슨·자료·처리 상태 확인
- 권한 확인 전 폼을 편집 가능 상태로 노출하지 않음

### 16.2 `DRAFT`

- 기본 정보 저장 상태 표시
- 초기 자료 준비 또는 이어서 편집 행동 제공
- 자료가 없어도 정상적인 초안 상태로 처리

### 16.3 업로드·처리 중

- 파일·작업 단위 진행 상태 표시
- 현재 작업 중 다른 자료 변경 방지
- 기본 정보 저장과 자료 처리 상태 분리
- 페이지 이탈 시 서버 작업 지속 여부 안내

### 16.4 실패

- 기본 정보 저장 실패
- 파일 업로드 실패
- 파일 검증 실패
- 파싱·embedding 실패
- Vector DB 삭제 실패
- 영향받은 AI 산출물 처리 실패

실패한 단계 가까이에 재시도 또는 복구 행동을 제공하며 기존 정상 자료를 전체 실패로 처리하지 않는다.

### 16.5 `READY`

- AI 준비 완료와 게시 가능 상태 표시
- 게시 전 최종 확인과 `PublishLessonAction` 제공
- 레슨 상세로 이동
- 기본 정보 수정과 단일 자료 추가·삭제 제공

### 16.6 `PUBLISHED`

- 수강생 공개 중 상태 표시
- 연결된 live session 생성·관리로 이동
- 자료 변경 시 공개 중단·AI 재처리·재게시 영향을 사전에 안내

### 16.7 잠금 상태

- 연결 세션 `LIVE`: 모든 필드를 읽기 전용으로 표시하고 라이브 레슨 이동 제공
- 연결 세션 `ENDED`: 제목·설명만 수정하고 VOD 레슨 이동 제공
- 허용되지 않는 행동은 UI와 서버 양쪽에서 차단

## 17. 저장되지 않은 변경과 작업 복구

- 기본 정보 dirty 상태와 초기 자료 선택 상태를 별도로 추적
- 기본 정보 미저장 상태에서 이탈 시 확인
- 초기 자료 선택 후 업로드 전 이탈 시 확인
- 업로드·임베딩·삭제 요청 이후에는 서버 작업 상태를 기준으로 복구
- 재진입 시 현재 자료 작업과 파일별 상태 조회
- 진행 중 요청을 완료로 오인하지 않음
- 중복 업로드·삭제·재시도 요청 방지

이후 단일 자료 추가·삭제는 즉시 실행되므로 별도의 미적용 변경 목록을 두지 않는다.

## 18. 주요 사용자 행동

### 18.1 생성

- 상위 커리큘럼·섹션 확인
- 기본 정보 입력·초안 저장
- 초기 PPTX 복수 선택·업로드
- 실패 파일 재시도·제거
- 초기 AI 준비 시작
- 준비 상태 확인
- `READY` 레슨 최종 확인·게시
- 레슨 상세 또는 커리큘럼 관리로 이동

### 18.2 수정

- 기본 정보 저장
- 자료 한 개 추가
- 자료 한 개 삭제
- 자료 다운로드
- 처리 실패 재시도
- `READY` 레슨 게시
- 레슨 상세·라이브 세션·VOD로 상태에 맞게 이동

## 19. 필요한 데이터와 연결

정확한 필드와 API는 [API_MAP.md](../API_MAP.md)에서 확정한다.

### 19.1 초기 데이터

- 커리큘럼·섹션 식별 정보
- 현재 사용자의 관리 권한
- 생성·수정 모드
- 수정 모드의 레슨 기본 정보
- lesson 상태와 연결된 `liveSessionId`
- AI·녹화 자산·replay 상태 요약
- 역할·상태별 허용 행동

### 19.2 자료 데이터

- 자료 식별자·원본 파일명·파일 크기·순서
- 파일별 업로드·검증·파싱·embedding·삭제 상태
- 현재 실행 중인 자료 작업
- 자료별 영향받은 AI 근거·산출물 상태
- 다운로드 정보

### 19.3 저장·처리 결과

- `DRAFT` 생성 결과와 `lessonId`
- 기본 정보 저장 결과
- 초기 자료 업로드와 AI 준비 결과
- 단일 자료 추가·삭제 결과
- AI 준비 완료 또는 실패 상태

## 20. 반응형과 접근성

- 모바일에서도 기본 정보와 자료 상태를 구분된 섹션으로 제공
- 파일 선택·진행·오류 상태를 색상 외 텍스트로 표시
- 자료 순서 변경을 도입하면 키보드 대체 행동 제공
- 삭제 확인 대화상자에 대상 파일과 영향 범위 명시
- 처리 상태 갱신을 과도한 live region 알림으로 제공하지 않음
- 오류 발생 후 해당 파일 또는 입력으로 포커스 이동
- 저장·업로드·삭제 버튼의 실행 중 상태를 보조기기에 전달

## 21. 미확정 사항

1. 제목·설명의 최대 길이
2. PPTX 파일별 최대 크기와 동일 파일 판정 기준
3. 게시 전 최종 확인 항목과 게시 취소 정책
4. 종료된 레슨 자료 revision과 VOD 게시본 교체 정책

## 22. 이후 기능 후보

- 종료된 레슨의 자료 revision과 VOD 게시본 원자적 교체
- PPTX 표시용 제목·설명
- 자료 일괄 다운로드
- 자료 버전 이력
- AI 없이 진행하는 레슨 정책
- 레슨 복제

후보 기능은 채택되기 전까지 필수 컴포넌트나 API로 간주하지 않는다.
