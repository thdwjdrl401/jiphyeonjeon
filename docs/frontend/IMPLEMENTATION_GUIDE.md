# LiveClass AI 프론트엔드 구현 가이드

작성일: 2026-07-20

## 1. 목적

현재 프론트엔드는 명세에 정의된 전체 라우트를 탐색하고 역할별 화면을 검토할 수 있는 UI 초안을 제공한다. 구현 우선순위는 다음과 같다.

1. 페이지와 사용자 동선을 먼저 완성한다.
2. 서버가 제공하는 허용 행동을 기준으로 권한 UI를 노출한다.
3. 확정 API는 실제 요청으로 연결하고, 미확정 API는 같은 화면 모델의 fixture로 검토한다.
4. LiveKit, HLS, WebSocket, SSE는 연결 seam을 유지하되 실제 SDK 연동 전까지 브라우저 상호작용 초안으로 제공한다.

## 2. 실행과 검토

```bash
cd frontend
npm run dev
```

- 개발 서버: `http://localhost:8083`
- `VITE_USE_MOCK_API=true`: 구현된 함수는 `/api`, 미구현 함수는 통합 mock을 사용
- `VITE_USE_MOCK_API=false`: 구현 여부와 무관하게 모든 데이터 함수가 `/api`를 호출하며 오류를 숨기지 않음
- 모든 화면은 공통 데이터 소스 경계를 사용하고, 함수별 `apiImplemented` 값으로 구현 여부를 명시한다([ADR-0014](../decisions/yoongwanghyeok/0014-operation-level-hybrid-api-routing.md)).
- 값을 바꾼 뒤에는 Vite 개발 서버를 다시 시작해야 함
- 값을 생략하면 개발 모드는 mock, 프로덕션 빌드는 실제 API를 사용
- 테스트 모드: 로컬 환경 변수와 무관하게 fixture를 사용해 독립 실행

fixture 로그인 계정은 이메일 문자열로 역할을 구분한다.

- 강사: `instructor@liveclass.ai` / 비밀번호 임의 값
- 학생: `student01@example.com` / 비밀번호 임의 값

통합 mock의 기본 학생 시나리오는 다음과 같다. 공개 목록, 공개 상세, 학생 내 커리큘럼이 모두 이 상태를 공유한다.

- 수강 중: `cur-spring-live`, `cur-data-story`, `cur-react-system`
- 승인 대기: `cur-sql`
- 미수강: 나머지 공개 커리큘럼
- 강사 소유: `instructorId`로 판정하며 기본 강사는 `cur-spring-live`, `cur-architecture`를 소유

## 3. 레이아웃 구조

| 레이아웃 | 파일 | 용도 |
|---|---|---|
| `PublicLayout` | `src/shared/layout/PublicLayout.tsx` | 웰컴, 탐색, 인증, 공개 상세 |
| `WorkspaceLayout` | `src/shared/layout/WorkspaceLayout.tsx` | 프로필, 대시보드, 생성·수정·관리, 세션 준비 |
| `LessonLayout` | `src/shared/layout/LessonLayout.tsx` | 라이브 강의실, VOD 다시보기 |
| 시스템 화면 | `ForbiddenPage`, `NotFoundPage` | 권한 부족과 안전한 404 안내 |

`WorkspaceLayout`은 인증 사용자 메뉴와 역할별 작업 메뉴를 제공한다. `LessonLayout`은 일반 footer와 sidebar를 제거하고 미디어와 보조 패널에 화면을 집중한다.

## 4. 전체 라우트 구현 상태

| 페이지 | 라우트 | 초기 구현 |
|---|---|---|
| 웰컴 | `/` | 실제/fixture 공개 목록 |
| 커리큘럼 탐색 | `/curriculums` | 실제/fixture 목록, 검색, 정렬, 페이지네이션 |
| 로그인 | `/login` | 실제/fixture 인증, 안전한 `returnTo` |
| 회원가입 | `/signup` | 실제/fixture 인증 |
| 커리큘럼 상세 | `/curriculums/:curriculumId` | 실제 최소 응답 보정 + fixture 관계별 UI |
| 학생 내 프로필 | `/student/profile` | 학생 프로필·학습 요약 fixture |
| 강사 내 프로필 | `/instructor/profile` | 강사 프로필·운영 요약 fixture |
| 학생 내 커리큘럼 | `/student/curriculums` | 학생 학습 대시보드 fixture |
| 강사 내 커리큘럼 | `/instructor/curriculums` | 강사 운영 대시보드 fixture |
| 커리큘럼 생성 | `/instructor/curriculums/new` | 기본 정보는 실제 생성 API 연결, 미확정 필드는 UI 초안 |
| 커리큘럼 관리 | `/instructor/curriculums/:curriculumId/manage` | 구조·기본 정보·수강생 관리 fixture |
| 레슨 생성 | `/instructor/curriculums/:curriculumId/sections/:sectionId/lessons/new` | 폼·PPTX 선택·AI 준비 상호작용 fixture |
| 레슨 수정 | `/instructor/curriculums/:curriculumId/sections/:sectionId/lessons/:lessonId/edit` | 기본 정보·증분 자료 UI fixture |
| 학생 레슨 상세 | `/student/curriculums/:curriculumId/sections/:sectionId/lessons/:lessonId` | 학생용 자료·세션·replay 허브 fixture |
| 강사 레슨 상세 | `/instructor/curriculums/:curriculumId/sections/:sectionId/lessons/:lessonId` | 강사용 준비·게시·운영 허브 fixture |
| 세션 생성 | `/instructor/lessons/:lessonId/live-sessions/new` | 일정·입장 창·운영 정책 폼 fixture |
| 세션 수정 | `/instructor/live-sessions/:sessionId/edit` | 일정 수정 폼 fixture |
| 학생 세션 상세 | `/student/live-sessions/:sessionId` | 학생의 상태별 다음 행동 fixture |
| 강사 세션 상세 | `/instructor/live-sessions/:sessionId` | 강사의 상태별 다음 행동 fixture |
| 학생 입장 점검 | `/student/live-sessions/:sessionId/prejoin` | 스피커·autoplay·네트워크·고지 확인 UI |
| 강사 사전 점검 | `/instructor/live-sessions/:sessionId/preflight` | 장치·서버 필수 조건 점검 UI |
| 학생 라이브 강의실 | `/student/live-sessions/:sessionId/classroom` | 학생 미디어 stage, 되감기, 채팅, 자막, AI, 자료 |
| 강사 라이브 강의실 | `/instructor/live-sessions/:sessionId/classroom` | 강사 미디어 송출과 세션 운영 제어 |
| 녹화 처리 | `/instructor/live-sessions/:sessionId/processing` | Egress/HLS·AI 단계 UI |
| 학생 VOD 다시보기 | `/student/lessons/:lessonId/replay` | 플레이어, 챕터, 자막 검색, 채팅 replay, AI, 퀴즈 |
| 강사 VOD 검수 | `/instructor/lessons/:lessonId/replay` | replay 콘텐츠 검수와 학습 통계 |
| 접근 불가 | `/forbidden` | 실패 사유별 복구 동선 |
| 찾을 수 없음 | `*` | 안전한 404와 탐색 동선 |

## 5. 권한과 라우팅

- 공개 탐색·인증은 `/`, `/curriculums/*`, `/login`, `/signup`에 둔다.
- 로그인 이후 학생 기능은 `/student/*`, 강사 기능은 `/instructor/*`에 둔다. 현재 사용자 역할에 없는 `/admin/*`는 만들지 않는다.
- `RequireRoleRoute`를 `student`, `instructor` 상위 라우트에 각각 한 번 배치한다. 자식 페이지마다 인증·역할 가드를 반복하지 않는다.
- 비로그인 사용자는 `/login`으로 보내고 현재 내부 경로를 `returnTo`로 보존한다.
- 다른 역할의 상위 라우트에 접근하면 `/forbidden?reason=student|instructor`로 이동한다.
- 화면 링크는 `src/app/router/paths.ts`의 경로 생성 함수를 사용해 역할 접두사와 동적 세그먼트를 한 곳에서 관리한다.
- URL 경로 단어와 프론트 fixture ID는 대시(`-`) 표기를 사용한다. 실제 API가 반환한 ID는 임의로 치환하지 않는다.
- 리소스 소유권과 수강 권한은 계정 역할만으로 확정하지 않는다. 실제 연동 시 서버의 `viewerContext.allowedActions` 또는 관리 API의 권한 결과로 교체해야 한다.
- 현재 fixture는 화면 검토를 위한 역할별 데이터만 제공하며 서버 권한 검사를 대신하지 않는다.

## 6. 데이터 경계

### 실제 연결 유지

- 인증과 세션 복원
- 이메일 중복 확인
- 공개 커리큘럼 목록과 상세
- 커리큘럼 생성의 현재 백엔드 지원 필드

위 요청은 각각 별도 환경 분기를 두지 않고 `src/shared/api/dataSource.ts`의 단일 선택 경계를 사용한다. **테스트 모드**에서 선택 경계를 우회한 Axios 요청은 `MOCK_API_NETWORK_REQUEST_BLOCKED` 오류로 차단해 테스트가 네트워크에 의존하지 않게 막는다. dev에서는 차단하지 않는다 — 막으면 이미 실 API로 옮긴 서비스까지 백엔드에 닿지 못해 점진 전환이 불가능해진다.

### fixture 우선

- 프로필 수정과 강사 공개 프로필
- 학생 수강 목록과 진행률
- 관리 페이지의 통합 구조·수강생 조회
- 커리큘럼 공통 강의 자료 등록·수정·조회
- PPTX 업로드와 AI 준비 과정
- 역할별 레슨 상세
- 세션 prejoin/preflight/처리 조회
- LiveKit·HLS·SSE·자막 실시간 연결
- replay 게시본·퀴즈·북마크

공개 커리큘럼 API는 현재 서버가 `viewerContext`, 수강 정책, 레슨 접근 정보를 반환하지 않아 프론트에서 권한을 부여하지 않는 읽기 전용 상태로 보정한다. 서버 필드가 추가되면 기존 값이 우선 사용된다.

fixture 데이터는 `src/features/demo/mockDatabase.ts`를 단일 원본으로 사용한다. 공개 목록, 상세, 수강 신청·취소, 학생·강사 대시보드, 라우트별 레슨·세션 화면은 동일한 ID와 관계 상태를 조회한다. 화면 표현용 `demoData.ts`와 각 feature의 mock 파일은 이 원본을 해당 화면 모델로 투영하는 어댑터다.

커리큘럼 공통 강의 자료는 선택 항목이며 현재 PPTX 복수 선택 UI와 fixture 저장 흐름만 제공한다. 생성 화면에서는 대표 이미지 오른쪽에서 등록하고, 관리 화면에서는 기본 정보 최하단에서 교체·삭제한다. 상세 화면은 `ENROLLED` 수강생과 `OWNER_INSTRUCTOR`에게만 자료 목록을 표시하며, 비로그인·미수강·승인 대기 학생과 비운영 강사에게는 파일 메타데이터도 노출하지 않는다. 실제 API가 없는 동안 실제 모드 응답의 `materials` 누락은 빈 배열로 정규화하고, 생성 요청에도 임의 필드를 전송하지 않는다.

## 7. 주요 소스 위치

```text
src/pages/                         라우트 단위 페이지 조합
src/features/demo/mockDatabase.ts  커리큘럼·수강·소유권·레슨·세션 fixture 단일 원본
src/features/demo/demoData.ts      단일 원본을 화면 모델로 변환하는 fixture 어댑터
src/features/curriculum/           공개 목록·상세 공통 모델
src/features/curriculum-detail/    상세 조회·수강 상태 UI
src/features/auth/                 인증과 라우트 가드
src/shared/api/dataSource.ts       VITE_USE_MOCK_API 기반 전역 데이터 소스 선택
src/shared/layout/                 Public·Workspace·Lesson 레이아웃
src/shared/ui/WorkspaceUi.tsx      PageHeader·Panel·상태·지표 공통 요소
src/styles/workspace.css           작업 페이지 스타일
src/styles/learning.css            라이브·VOD 스타일
```

## 8. 페이지별 수정 권장 순서

1. 내 커리큘럼: 실제 학생·강사 조회 계약 확정
2. 커리큘럼 관리: 현재 백엔드 CRUD 응답과 공통 강의 자료 계약에 맞춰 조회·저장 연결
3. 레슨 생성·수정·상세: PPTX 계약 범위를 제외한 기본 CRUD 연결
4. 라이브 세션 상세·폼: 구현된 일정·상태 API 연결
5. prejoin/preflight: 브라우저 장치 점검과 서버 readiness 연결
6. 라이브 강의실: LiveKit → STOMP 채팅 → 자막 → AI 순으로 연결
7. 녹화 처리와 VOD: Egress webhook·playback 계약 확정 후 연결
8. 프로필: 수정 API와 계정 정책 확정 후 연결

각 페이지를 실제 API로 전환할 때 fixture와 실제 응답을 같은 도메인 모델로 정규화하고, API JSON 필드·경로·상태코드를 검증하는 계약 테스트를 추가한다.

## 9. 현재 검증 기준

- 모든 문서상 라우트가 앱 라우터에 등록됨
- 로그인과 강사 역할 가드 적용
- 데스크톱·태블릿·모바일 레이아웃 제공
- 폼 입력, 탭, 점검, 채팅, AI 답변, 퀴즈 등 핵심 상호작용 제공
- TypeScript, ESLint, Vitest, Vite build를 완료 게이트로 사용
