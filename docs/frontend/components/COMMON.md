# LiveClass AI — 공통 컴포넌트

> 컴포넌트 원칙: [README.md](README.md) · 페이지 기준: [PAGES.md](../PAGES.md)

## 1. 현재 범위

공통 레이아웃과 이를 구성하는 내비게이션만 정의한다. 버튼·폼·피드백 컴포넌트는 첫 페이지를 설계하면서 실제 재사용 요구가 확인될 때 추가한다.

## 2. 공통 레이아웃

| 레이아웃 | 책임 | 사용 페이지 |
|---|---|---|
| `PublicLayout` | 전역 헤더·본문·푸터 제공 | 웰컴, 커리큘럼 목록·상세, 로그인, 회원가입 |
| `WorkspaceLayout` | 로그인 후 작업 메뉴와 본문 제공 | 내 프로필, 내 커리큘럼, 생성·수정·관리 |
| `LessonLayout` | 미디어 중심 본문과 학습 보조 패널 제공 | 라이브 레슨, VOD 레슨 |
| `SystemLayout` | 오류 안내와 복구 행동을 단순하게 배치 | 접근 불가, 찾을 수 없음 |

### 2.1 `PublicLayout`

```text
PublicLayout
├─ SkipLink
├─ GlobalHeader
├─ MainContent
│  └─ Outlet
└─ GlobalFooter
```

- 비로그인: 로그인·회원가입 행동 노출
- 학생: 내 커리큘럼과 사용자 메뉴 노출
- 강사: 내 커리큘럼·커리큘럼 생성과 사용자 메뉴 노출
- 모바일에서는 전역 메뉴를 drawer로 전환

### 2.2 `WorkspaceLayout`

```text
WorkspaceLayout
├─ SkipLink
├─ GlobalHeader
├─ WorkspaceSidebar
└─ MainContent
   ├─ Breadcrumbs
   └─ Outlet
```

- 학생 메뉴: 내 커리큘럼, 내 프로필
- 강사 메뉴: 내 커리큘럼, 커리큘럼 생성, 내 프로필
- 해당 커리큘럼 강사만 관리 메뉴 노출
- 모바일에서는 sidebar를 작업 메뉴 drawer로 전환

### 2.3 `LessonLayout`

```text
LessonLayout
├─ LessonHeader
├─ LessonPrimaryContent
├─ LessonSidePanel
└─ LessonStatusRegion
```

- 라이브와 VOD가 화면 골격을 공유
- 주 콘텐츠에는 LiveKit 미디어 또는 HLS 플레이어 배치
- 보조 패널에는 페이지가 목차·자막·채팅·AI feature를 조합
- 강사 컨트롤과 수강생 도구는 레이아웃이 아닌 feature에서 권한별로 조합
- 모바일에서는 보조 패널을 탭 또는 drawer 형태로 전환
- 일반 footer와 workspace sidebar는 사용하지 않음

### 2.4 `SystemLayout`

```text
SystemLayout
├─ BrandLink
└─ MainContent
   └─ Outlet
```

- 접근 실패 원인과 복구 행동은 시스템 페이지가 결정
- 레이아웃은 읽기 쉬운 단순 배치만 제공

## 3. 공통 내비게이션

| 컴포넌트 | 책임 | 소유 영역 |
|---|---|---|
| `GlobalHeader` | 브랜드·주요 메뉴·사용자 행동 조합 | `app` |
| `GlobalFooter` | 서비스 공통 하단 정보 | `app` |
| `PrimaryNavigation` | 전역 페이지 이동 | `app` |
| `WorkspaceSidebar` | 로그인 후 작업 메뉴 | `app` |
| `Breadcrumbs` | 현재 페이지 계층 표시 | `app` |
| `GuestAuthActions` | 로그인·회원가입 이동 | `features/auth` |
| `AuthenticatedUserMenu` | 프로필·내 커리큘럼·로그아웃 | `features/auth` |
| `SkipLink` | 반복 내비게이션을 건너뛰고 본문 이동 | `shared` |
| `BrandLink` | 브랜드 표시와 웰컴 이동 | `shared` |

`GlobalHeader`는 인증 로직을 직접 소유하지 않고 `GuestAuthActions` 또는 `AuthenticatedUserMenu`를 조합한다.

## 4. 범용 레이아웃 요소

도메인을 모르는 요소만 `shared`에 둔다.

| 컴포넌트 | 책임 |
|---|---|
| `PageContainer` | 최대 너비와 좌우 여백 통일 |
| `MainContent` | `main` landmark와 skip target 제공 |
| `PageHeader` | 페이지 제목·설명·대표 행동 배치 |
| `PageSection` | 제목이 있는 본문 구획 |
| `SplitPane` | 주 콘텐츠와 보조 패널 배치 |
| `StickyActionBar` | 긴 폼의 저장·취소 행동 고정 |

`Stack`, `Grid` 같은 추상 배치 컴포넌트는 실제 반복이 확인되기 전에는 만들지 않는다.

## 5. 상태 소유권

| 상태 | 소유 위치 |
|---|---|
| 인증 사용자·계정 유형 | `features/auth` |
| 현재 라우트와 활성 메뉴 | Router |
| 모바일 메뉴 열림 | 메뉴 컴포넌트 로컬 상태 |
| breadcrumb 표시 데이터 | page 또는 route handle |
| 레슨 보조 패널 열림 | `LessonLayout` 또는 lesson page |
| 커리큘럼·레슨 데이터 | page 또는 관련 feature |
| 리소스 접근 권한 | page 조회 결과 |

레이아웃은 페이지 데이터를 직접 조회하거나 계정 유형만으로 리소스 권한을 추론하지 않는다.

## 6. 페이지별 레이아웃 매핑

| 페이지 | 레이아웃 |
|---|---|
| 웰컴 | `PublicLayout` |
| 커리큘럼 목록 | `PublicLayout` |
| 로그인·회원가입 | `PublicLayout` |
| 커리큘럼 상세 | `PublicLayout` |
| 내 프로필·내 커리큘럼 | `WorkspaceLayout` |
| 커리큘럼 생성·관리 | `WorkspaceLayout` |
| 레슨 생성·수정·상세 | `WorkspaceLayout` |
| 라이브 세션 생성·수정·상세·점검·처리 | `WorkspaceLayout` |
| 라이브·VOD 레슨 | `LessonLayout` |
| 접근 불가·찾을 수 없음 | `SystemLayout` |

## 7. 현재 확인할 사항

1. `WorkspaceSidebar`를 모든 로그인 작업 페이지에 표시할지
2. 로그인·회원가입을 독립 페이지로 유지할지 route modal로 바꿀지
3. 모바일 레슨 보조 패널을 탭과 drawer 중 어떤 방식으로 제공할지
4. 공개 페이지에 `GlobalFooter`를 항상 표시할지
