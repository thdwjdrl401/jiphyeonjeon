# LiveClass AI — 공개 페이지 컴포넌트

> 컴포넌트 원칙: [README.md](README.md) · 공통 레이아웃: [COMMON.md](COMMON.md) · 페이지 기준: [PAGES.md](../PAGES.md)

## 1. 범위

`PublicLayout`을 사용하는 다음 네 페이지를 함께 정의한다.

- 웰컴
- 커리큘럼 목록
- 로그인
- 회원가입

커리큘럼 상세도 `PublicLayout`을 사용하지만 사용자와 커리큘럼의 관계에 따른 분기가 많으므로 별도 문서에서 다룬다.

## 2. 공통 조합 원칙

- 네 페이지 모두 `PublicLayout`의 헤더·본문·푸터를 공유한다.
- 페이지는 라우트 상태와 feature를 조합하고, 공통 레이아웃을 다시 구현하지 않는다.
- 인증 UI는 `features/auth`, 커리큘럼 UI는 `features/curriculum`이 소유한다.
- 페이지 전용 소개 문구와 섹션 조합은 `pages`가 소유한다.
- 로그인·회원가입 완료 후 복귀 경로와 실제 API는 [API_MAP.md](../api/API_MAP.md)에서 정의한다.

## 3. 웰컴 페이지

### 3.1 목적

서비스의 핵심 가치를 소개하고 커리큘럼 탐색 및 사용자 유형별 주요 행동으로 연결한다.

### 3.2 컴포넌트 트리

```text
WelcomePage
├─ WelcomeHero
│  └─ WelcomePrimaryActions
├─ FeatureHighlights
├─ FeaturedCurriculumSection
│  └─ CurriculumCard[]
└─ RoleQuickActions
```

### 3.3 컴포넌트 책임

| 컴포넌트 | 소유 영역 | 책임 |
|---|---|---|
| `WelcomePage` | `pages` | 웰컴 섹션 조합과 페이지 상태 처리 |
| `WelcomeHero` | page 전용 | 서비스 한 줄 소개와 핵심 메시지 표시 |
| `WelcomePrimaryActions` | page 전용 | 커리큘럼 탐색 등 대표 CTA 배치 |
| `FeatureHighlights` | page 전용 | 라이브·자막·근거·따라잡기 기능 소개 |
| `FeaturedCurriculumSection` | `features/curriculum` 또는 page 조합 | 추천 커리큘럼 영역 제목·목록·전체 보기 제공 |
| `CurriculumCard` | `features/curriculum` | 커리큘럼 요약과 관계별 행동 표시 |
| `RoleQuickActions` | page 조합 | 인증 상태와 계정 유형에 맞는 빠른 행동 제공 |

### 3.4 사용자별 표시

| 사용자 | `RoleQuickActions` |
|---|---|
| 비로그인 | 로그인, 회원가입 |
| 학생 | 내 커리큘럼, 최근 학습 이어보기 |
| 강사 | 커리큘럼 생성, 운영 중인 커리큘럼 |

추천 커리큘럼과 서비스 소개는 모든 사용자에게 동일하게 표시한다.

### 3.5 주요 행동

- 커리큘럼 목록으로 이동
- 추천 커리큘럼 상세로 이동
- 로그인·회원가입으로 이동
- 학생은 내 커리큘럼 또는 최근 학습으로 이동
- 강사는 커리큘럼 생성 또는 관리로 이동

### 3.6 상태

- 추천 커리큘럼 로딩
- 추천 결과 없음
- 추천 조회 실패
- 정상 표시

추천 조회 실패가 웰컴 전체를 막지 않도록 서비스 소개와 기본 탐색 CTA는 유지한다.

### 3.7 필요한 데이터

- 현재 인증 상태와 계정 유형
- 추천 커리큘럼 요약 목록
- 학생의 최근 학습 또는 강사의 운영 커리큘럼 요약은 빠른 행동을 실제 데이터로 제공할 때만 필요

### 3.8 미확정 사항

- 추천 커리큘럼 선정 기준
- 학생·강사 빠른 행동에 실제 데이터 요약을 표시할지 단순 링크만 제공할지

## 4. 커리큘럼 목록 페이지

### 4.1 목적

비로그인 사용자를 포함한 모든 사용자가 공개 커리큘럼을 검색·필터·정렬하고 상세로 이동하도록 한다.

### 4.2 컴포넌트 트리

```text
CurriculumListPage
├─ CurriculumListHeader
├─ CurriculumSearchControls
│  ├─ CurriculumSearchInput
│  ├─ CurriculumFilters
│  └─ CurriculumSort
├─ CurriculumResultSummary
└─ CurriculumGrid
   └─ CurriculumCard[]
```

결과 상태에 따라 `CurriculumGrid` 위치에 로딩, 빈 결과, 오류 상태를 표시한다.

### 4.3 컴포넌트 책임

| 컴포넌트 | 소유 영역 | 책임 |
|---|---|---|
| `CurriculumListPage` | `pages` | URL 검색 조건과 조회 결과 조합 |
| `CurriculumListHeader` | page 전용 | 페이지 제목과 설명 표시 |
| `CurriculumSearchControls` | `features/curriculum` | 검색·필터·정렬 입력 조합 |
| `CurriculumSearchInput` | `features/curriculum` | 검색어 입력·제출·초기화 |
| `CurriculumFilters` | `features/curriculum` | 상태·주제·강사 등 확정된 필터 제공 |
| `CurriculumSort` | `features/curriculum` | 정렬 기준 선택 |
| `CurriculumResultSummary` | `features/curriculum` | 검색 조건과 결과 수 요약 |
| `CurriculumGrid` | `features/curriculum` | 커리큘럼 카드의 반응형 목록 배치 |
| `CurriculumCard` | `features/curriculum` | 커리큘럼 요약과 사용자 관계별 CTA 표시 |

### 4.4 사용자별 카드 표시

| 관계 | 카드에 표시할 추가 정보 |
|---|---|
| 비로그인 | 상세 보기 |
| 학생·미수강 | 수강 가능 상태 |
| 수강생 | 학습 진행률과 학습 계속하기 |
| 해당 커리큘럼 강사 | 관리하기와 다음 레슨 |
| 다른 강사 | 상세 보기와 수강 정책 안내 |

관계 판정은 `CurriculumCard` 내부에서 계정 유형만으로 추론하지 않고 조회 결과의 관계·허용 행동을 사용한다.

### 4.5 주요 행동

- 검색어 적용·초기화
- 필터·정렬 변경
- 다음 결과 페이지 조회
- 커리큘럼 상세 이동
- 수강생은 학습 계속하기
- 해당 커리큘럼 강사는 관리 페이지로 이동

### 4.6 상태

- 최초 목록 로딩
- 조건 변경 후 결과 로딩
- 검색 결과 없음
- 공개 커리큘럼 자체가 없음
- 조회 실패와 재시도
- 정상 목록

검색 결과 없음과 서비스에 등록된 커리큘럼 없음은 다른 안내와 행동을 제공한다.

### 4.7 필요한 데이터

- 검색어·필터·정렬·페이지 정보
- 커리큘럼 요약 목록과 전체 결과 수
- 각 커리큘럼에 대한 현재 사용자의 관계와 허용 행동
- 수강생 진행률 또는 강사 운영 정보는 카드에 실제로 표시할 때만 포함

### 4.8 미확정 사항

- 확정 필터와 정렬 기준
- 페이지네이션과 무한 스크롤 중 선택
- 검색 조건을 URL query parameter에 어느 범위까지 보존할지

## 5. 로그인 페이지

### 5.1 목적

사용자를 인증하고 인증이 필요했던 원래 목적지로 복귀시킨다.

### 5.2 컴포넌트 트리

```text
LoginPage
├─ AuthPageIntro
├─ LoginForm
│  ├─ UserIdField
│  ├─ PasswordField
│  ├─ LoginErrorMessage
│  └─ LoginSubmitButton
└─ SignupLink
```

### 5.3 컴포넌트 책임

| 컴포넌트 | 소유 영역 | 책임 |
|---|---|---|
| `LoginPage` | `pages` | 복귀 목적지 확인과 로그인 feature 배치 |
| `AuthPageIntro` | `features/auth` 또는 인증 페이지 공통 | 인증 화면 제목과 안내 |
| `LoginForm` | `features/auth` | 입력·검증·제출 상태 조합 |
| `LoginErrorMessage` | `features/auth` | 계정 없음·비밀번호 불일치 등 로그인 실패 안내 |
| `LoginSubmitButton` | `features/auth` | 제출 중 중복 요청 방지와 진행 상태 표시 |
| `SignupLink` | `features/auth` | 회원가입 이동 및 필요 시 복귀 목적지 보존 |

### 5.4 접근과 전환

- 비로그인 사용자만 접근
- 로그인 사용자가 직접 접근하면 이전 목적지 또는 웰컴으로 이동
- 로그인 성공 후 안전하게 검증된 내부 복귀 경로로 이동
- 복귀 경로가 없으면 사용자 유형별 기본 페이지로 이동

### 5.5 상태

- 기본 입력
- 클라이언트 입력 오류
- 제출 중
- 인증 실패
- 로그인 성공 후 이동

### 5.6 필요한 데이터

- 사용자 입력 아이디와 비밀번호
- 내부 복귀 경로
- 로그인 처리 결과

### 5.7 미확정 사항

- 로그인·회원가입을 독립 페이지로 유지할지 route modal로 전환할지
- 자동 로그인 또는 아이디 저장 제공 여부

## 6. 회원가입 페이지

### 6.1 목적

사용자가 강사 또는 학생 계정 유형을 선택하고 계정을 생성하도록 한다.

### 6.2 컴포넌트 트리

```text
SignupPage
├─ AuthPageIntro
├─ AccountTypeSelector
├─ SignupForm
│  ├─ CommonAccountFields
│  ├─ InstructorFields | StudentFields
│  ├─ TermsAgreement
│  ├─ SignupErrorMessage
│  └─ SignupSubmitButton
└─ LoginLink
```

강사·학생 전용 입력이 실제로 없다면 `InstructorFields`와 `StudentFields`는 만들지 않는다.

### 6.3 컴포넌트 책임

| 컴포넌트 | 소유 영역 | 책임 |
|---|---|---|
| `SignupPage` | `pages` | 회원가입 feature 조합과 완료 후 이동 |
| `AccountTypeSelector` | `features/auth` | 강사·학생 계정 유형 선택 |
| `SignupForm` | `features/auth` | 전체 입력·검증·제출 상태 조합 |
| `CommonAccountFields` | `features/auth` | 이름·아이디·비밀번호 등 공통 입력 |
| `InstructorFields` | `features/auth` | 확정된 강사 전용 정보가 있을 때만 표시 |
| `StudentFields` | `features/auth` | 확정된 학생 전용 정보가 있을 때만 표시 |
| `TermsAgreement` | `features/auth` | 필수·선택 약관 동의가 확정되면 제공 |
| `LoginLink` | `features/auth` | 로그인으로 이동 |

### 6.4 계정 유형별 구성

| 선택 유형 | 공통 입력 외 추가 구성 |
|---|---|
| 강사 | 강사 전용 필드가 확정된 경우에만 추가 |
| 학생 | 학생 전용 필드가 확정된 경우에만 추가 |

계정 유형만 선택하고 나머지 입력이 같다면 하나의 폼을 공유한다. 같은 필드를 강사 폼과 학생 폼으로 복제하지 않는다.

### 6.5 주요 행동

- 강사·학생 계정 유형 선택
- 아이디 중복 확인
- 입력 검증
- 회원가입 제출
- 가입 완료 후 로그인 또는 자동 로그인 흐름으로 이동

### 6.6 상태

- 계정 유형 미선택
- 기본 입력
- 아이디 중복 확인 중·사용 가능·중복
- 입력 오류
- 제출 중
- 가입 실패
- 가입 완료

### 6.7 필요한 데이터

- 선택한 계정 유형
- 공통 계정 입력
- 확정된 경우 강사·학생 전용 입력
- 아이디 중복 확인 상태
- 회원가입 처리 결과

### 6.8 미확정 사항

- 강사·학생 전용 가입 정보
- 계정 유형 변경 허용 여부
- 가입 완료 후 자동 로그인 여부
- 이용약관·개인정보 동의 범위

## 7. 공개 페이지 공통 확인 사항

1. 로그인·회원가입을 독립 페이지로 유지할지 route modal로 전환할지
2. 추천 커리큘럼과 전체 목록에서 같은 `CurriculumCard` 변형을 사용할지
3. 목록의 필터·정렬 기준과 페이지네이션 방식
4. 강사·학생 전용 회원가입 필드
5. 가입·로그인 완료 후 기본 이동 위치

위 결정이 복잡해져 로그인·회원가입 문서가 지나치게 커지면 두 페이지를 `AUTH.md`로 분리하고 [README.md](README.md)의 인덱스를 함께 갱신한다.
