# LiveClass AI — 프론트엔드 컴포넌트 명세 안내

> 페이지 기준: [PAGES.md](../PAGES.md) · API 연동 맵: [API_MAP.md](../api/API_MAP.md) · 공통 컴포넌트: [COMMON.md](COMMON.md)

## 1. 목적

이 디렉터리는 프론트엔드 컴포넌트의 구조·권한·상태처럼 팀 합의가 필요한 내용을 기록한다. TypeScript props, 이벤트 핸들러 이름, CSS 클래스 등 코드가 더 정확하게 표현하는 세부사항은 문서에 중복하지 않는다.

## 2. 구조 원칙

프론트엔드는 역할별 구조와 feature 구조를 결합한 혼합형을 사용한다.

```text
app → pages → features → shared
```

| 영역 | 책임 |
|---|---|
| `app` | 앱 초기화, Router, Provider, 라우트별 레이아웃 조립 |
| `pages` | 라우트 단위 데이터 조회와 feature 조합 |
| `features` | 인증, 커리큘럼, 수강, 레슨, 라이브 등 비즈니스 기능 |
| `shared` | 도메인을 모르는 범용 UI, 레이아웃 요소, 유틸리티 |

의존성 규칙:

- `shared`는 상위 계층을 참조하지 않는다.
- `features`는 `pages`와 `app`을 참조하지 않는다.
- 여러 feature의 조합은 우선 page에서 담당한다.
- 공통화는 두 곳 이상에서 같은 의미와 책임으로 사용될 때 적용한다.
- 페이지별 컴포넌트를 미리 모두 공통 컴포넌트로 만들지 않는다.

## 3. 문서 분리 기준

- 공통 레이아웃·내비게이션·피드백: [COMMON.md](COMMON.md)
- 복잡한 페이지: 페이지별 문서 하나
- 단순한 관련 페이지: 하나의 문서로 묶을 수 있음
- 실제 설계나 구현을 시작하지 않은 페이지는 빈 문서를 미리 만들지 않음
- 여러 페이지를 한 문서로 묶을 때는 이 README의 문서 인덱스에 포함 페이지를 명시함
- 이후 페이지 묶음이 추가되거나 분리되면 실제 문서와 README 인덱스를 같은 변경에서 갱신함

### 3.1 공개 페이지 묶음

다음 네 페이지는 비교적 단순하고 모두 `PublicLayout`을 사용하므로 `PUBLIC_PAGES.md` 하나에서 함께 명세한다.

- 웰컴
- 커리큘럼 목록
- 로그인
- 회원가입

로그인·회원가입의 인증 흐름과 폼 명세가 커지면 `AUTH.md`로 분리할 수 있다. 분리 시 `PUBLIC_PAGES.md`와 이 README 인덱스를 함께 수정한다.

### 3.2 별도 문서를 우선 고려할 페이지

- 커리큘럼 상세
- 내 커리큘럼
- 커리큘럼 관리
- 라이브 세션 준비·상세
- 라이브 레슨
- VOD 레슨

접근 불가·찾을 수 없음은 [SYSTEM_PAGES.md](SYSTEM_PAGES.md)에서 함께 명세한다.

## 4. 페이지별 명세 범위

페이지 문서에는 구현에 필요한 최소한의 합의만 기록한다.

```md
# 페이지명

## 목적

## 컴포넌트 트리

## 컴포넌트 책임

## 접근 권한과 표시 조건

## 주요 사용자 행동

## 상태
- loading
- empty
- error
- success

## 필요한 데이터

## 미확정 사항
```

다음 내용은 특별한 합의가 필요한 경우가 아니면 코드에서 정의한다.

- 정확한 props 타입
- 모든 이벤트 핸들러 이름
- CSS 클래스 구조
- 작은 프리젠테이션 컴포넌트의 파일 분리
- 내부 훅과 유틸리티 이름

## 5. 작업 순서

1. 페이지 목적과 사용자 흐름 확인
2. 해당 페이지 문서 작성
3. 페이지 단위 구현
4. 반복되는 책임 확인
5. 필요한 컴포넌트만 공통으로 승격
6. 다음 페이지 반복

## 6. 문서 인덱스

| 문서 | 상태 | 범위 |
|---|---|---|
| [COMMON.md](COMMON.md) | 초안 | 공통 레이아웃과 내비게이션 |
| [PUBLIC_PAGES.md](PUBLIC_PAGES.md) | 초안 | 웰컴, 커리큘럼 목록, 로그인, 회원가입 |
| [PROFILE.md](PROFILE.md) | 초안 | 공통 계정 정보와 강사·학생 역할별 프로필 |
| [CURRICULUM_DETAIL.md](CURRICULUM_DETAIL.md) | 초안 | 커리큘럼 상세와 관계별 구성 |
| [MY_CURRICULUMS.md](MY_CURRICULUMS.md) | 초안 | 강사·학생의 내 커리큘럼 대시보드 |
| [CURRICULUM_FORM.md](CURRICULUM_FORM.md) | 초안 | 커리큘럼 생성·기본 정보 수정 공통 폼 |
| [CURRICULUM_MANAGEMENT.md](CURRICULUM_MANAGEMENT.md) | 초안 | 기본 정보·편성·수강생 관리와 레슨별 자료 상태 |
| [LESSON_FORM.md](LESSON_FORM.md) | 초안 | 레슨 생성·수정 공통 폼과 PPTX 초기·증분 자료 처리 |
| [LESSON_DETAIL.md](LESSON_DETAIL.md) | 초안 | lesson 준비·게시·자료와 연결 live session·replay 허브 |
| [LIVE_SESSION.md](LIVE_SESSION.md) | 초안 | live session 일정·상세·prejoin·preflight·녹화 처리 |
| [LIVE_LESSON.md](LIVE_LESSON.md) | 초안 | 강사·수강생 라이브 레슨과 실시간 미디어·학습 기능 |
| [VOD_LESSON.md](VOD_LESSON.md) | 초안 | Egress VOD 재생과 게시 콘텐츠·학습·강사 검수 기능 |
| [SYSTEM_PAGES.md](SYSTEM_PAGES.md) | 초안 | 접근 불가와 찾을 수 없음의 원인별 복구 동선 |

페이지별 문서를 만들거나 여러 페이지를 한 문서로 묶을 때 이 표에 링크와 포함 페이지를 추가한다. 작성 예정 문서가 실제로 생성되면 파일명 표기를 링크로 변경한다.
