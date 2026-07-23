# AGENTS.md — Frontend (React + TypeScript)

> 📍 정본 규칙: [../AGENTS.md](../AGENTS.md) · 공유 계약: [../docs/CONTRACT.md](../docs/CONTRACT.md) · 판단 정책: [../docs/harness/POLICY.md](../docs/harness/POLICY.md)
>
> 이 파일은 frontend 작업 시의 스택별 규칙만 다룹니다. 계약·완료 게이트·커밋 규칙은 정본을 따르세요.

## 스택·환경

- React **19** · TypeScript · Vite · React Router · **TanStack Query**(서버 상태) · 최소 전역 UI 상태(Context/Zustand) · Axios. Node.js 20.18 LTS.
- AI 응답은 **SSE**, 채팅/자막은 **WebSocket**(누락은 REST로 보완). API 타입은 OpenAPI 생성 권장(임의 DTO 복제 금지).
- 개발 서버 8083. **FE/BE 분리 배포** — React를 독립 서비스(정적 호스팅/컨테이너)로 배포, Spring은 API+WS만([../docs/decisions/songjeongki/0002](../docs/decisions/songjeongki/0002-react-typescript-frontend.md)).
- UI 프레임워크 없이 기존 CSS와 네이티브 HTML 요소를 사용.

## 구조 (`frontend/src`)

```text
App.tsx · main.tsx
app/                ← 라우터·QueryClient 등 앱 조립
pages/              ← 라우트 화면
features/           ← 도메인별 UI·타입·서비스 경계
shared/             ← 공용 API client·설정·레이아웃·UI·유틸리티
styles/ · assets/
test/               ← 모든 Vitest/React Testing Library 테스트
  features/         ← feature 단위 서비스·순수 함수·컴포넌트 테스트
  shared/           ← 공용 API·유틸리티 테스트
  integration/      ← App·라우터·복합 사용자 흐름 테스트
```

테스트 배치 세부 기준은 [src/test/README.md](src/test/README.md)를 따른다. 구현 디렉터리 옆에는 `*.test.ts(x)`를 두지 않는다.

## 계약 주의 (FE가 지킬 것)

- BE 응답을 소비할 때 **camelCase** 필드 계약을 따른다([CONTRACT §1](../docs/CONTRACT.md#1-필드명-규칙--camelcase-통일)). snake 필드가 오면 BE와 함께 정정하며 FE 변환 우회는 금지.
- **인증 = HttpOnly 쿠키 세션**([../docs/decisions/songjeongki/0014](../docs/decisions/songjeongki/0014-auth-redis-session-cookie.md)). 공용 Axios는 `/api`을 base URL로 쓰고 **`withCredentials: true`** 로 쿠키를 자동 전송한다. **`Authorization: Bearer`·localStorage 토큰은 쓰지 않는다**(쿠키는 JS가 읽지 않음). 상태변경 요청엔 **CSRF 토큰** 동봉.
- `EventSource`(RAG SSE)·`WebSocket`(자막·채팅)도 same-origin 쿠키로 인증됨 → 별도 토큰 부착 불필요. 401·403 처리(로그아웃·리다이렉트)는 CP0 구현 범위.

## API feature 개발 경계

API를 사용하는 feature는 [ADR-0015](../docs/decisions/yoongwanghyeok/0015-feature-service-adapter-routing.md)의 구현체 단위 전환을 따른다.

```text
<feature>Service.interface.ts  ← 화면이 의존하는 함수·타입 계약
mock<Feature>Service.ts        ← mock 데이터·상태 전이 구현
http<Feature>Service.ts        ← 실제 API 호출·응답 매핑
<feature>Service.ts            ← 구현체 선택과 공개 facade
use*Queries.ts                 ← TanStack Query 조회
use*Mutations.ts               ← 변경 요청과 캐시 무효화
```

- 외부 API 계약의 정본은 `docs/CONTRACT.md`와 실제 백엔드 코드다. Mock은 기능을 먼저 검증하는 구현체이지 계약의 정본이 아니다.
- Mock과 HTTP는 같은 Interface와 화면 모델을 반환하고 `satisfies <Feature>Service` 등으로 정적 검증한다.
- `VITE_USE_MOCK_API=true`면 모든 feature가 Mock 구현체, `false`면 모든 feature가 HTTP 구현체를 사용한다. 페이지별·함수별 혼합, HTTP 실패 시 Mock fallback은 금지한다.
- 일반 애플리케이션 페이지·컴포넌트·훅은 `mock*Service`, `http*Service`, mock fixture/store, `apiClient`를 직접 import하지 않는다. 공개 service facade 또는 Query/Mutation 훅만 호출한다.
- `apiClient`는 HTTP 구현체, mock store는 해당 Mock 구현체와 필요한 mock 조립 코드에서만 사용한다. 테스트는 검증 목적에 따라 구현체를 직접 import할 수 있다.
- 변경 가능한 Mock 상태는 해당 도메인 feature가 소유한다. 여러 화면이 같은 관계·상태를 표시하면 동일한 Mock 원본에서 파생한다.
- Mutation 성공·실패 뒤 목록·상세·대시보드 등 영향받는 Query Key를 무효화하거나 갱신한다.
- 페이지에 고정 fixture, 직접 Mock 호출, "API 준비 중" 안내를 기능 완료처럼 남기지 않는다.

## Frontend 작업 순서

1. 작업 대상 feature의 Interface/Mock/HTTP/facade/훅과 `src/test`의 관련 테스트를 먼저 조사한다.
2. 사용자 흐름, 역할, 소유권, 상태 전이, 로딩·빈 상태·오류·재시도 동작을 정한다.
3. `*Service.interface.ts`의 함수와 화면 모델을 먼저 확정한다.
4. Mock 구현체에 실제 서비스처럼 이어지는 전체 흐름을 구현하고 화면을 facade/훅에 연결한다.
5. 실제 백엔드의 Method·URL·DTO·상태코드·권한 규칙을 코드와 `CONTRACT.md`에서 대조한다.
6. 동일한 Interface를 만족하도록 HTTP 구현체와 응답 매핑을 작성한다.
7. Query/Mutation 캐시 갱신을 연결하고 Mock 동작·HTTP 계약·필요한 화면 통합 테스트를 작성한다.
8. API 계약이나 기술 결정이 바뀌면 루트 완료 게이트에 따라 `CONTRACT.md`, FE/BE 코드, 계약 테스트, ADR을 함께 갱신한다.

백엔드 API가 없거나 현재 계약으로 구현할 수 없는 경우 HTTP 완료를 가장하거나 존재하지 않는 endpoint를 추측해 만들지 않는다. 다음을 미구현 사항으로 보고한다.

- 필요한 Method와 URL
- 요청·응답 DTO
- 상태코드
- 인증·역할·소유권 규칙
- 백엔드에서 추가 또는 변경할 내용

프론트 작업만 요청받은 상태에서 FE/BE 공유 계약 변경이 필요하면 임의로 백엔드를 수정하지 말고 먼저 사용자에게 범위와 변경 필요사항을 알린다.

## 테스트 규칙

모든 프론트 테스트는 [ADR-0018](../docs/decisions/yoongwanghyeok/0018-centralized-frontend-test-directory.md)에 따라 `frontend/src/test` 아래에 둔다.

- feature 소유 동작: `src/test/features/<feature>/`
- 공용 API·유틸리티: `src/test/shared/`
- App·라우터·여러 feature 사용자 흐름: `src/test/integration/`
- 공통 초기화: `src/test/setup.ts`
- 중앙 테스트에서 구현 코드는 `@/` alias로 import한다.
- 테스트 모드는 기본적으로 Mock 데이터 소스를 사용하며 실제 네트워크 요청을 허용하지 않는다.
- HTTP 계약 테스트는 런타임을 HTTP로 강제하고 `apiClient`를 spy/mock 처리해 Method·URL·DTO·응답 매핑을 검증한다.
- 상태 기능은 정상 흐름뿐 아니라 권한 오류, 종료 상태, 재시도, 연관 화면 간 일관성을 함께 검증한다.

완료 전에는 최소한 다음을 확인한다.

- Mock/HTTP가 같은 Interface와 상태 규칙을 만족한다.
- 로그인·역할·소유권·리소스 상태별 접근 결과가 Mock과 HTTP에서 일치한다.
- Mock 모드에 실제 네트워크 요청이 없고 HTTP 모드에 조용한 Mock fallback이 없다.
- 로딩·빈 상태·오류·재시도 UI와 Mutation 후 캐시 갱신이 동작한다.
- 구현 디렉터리에 `*.test.ts(x)`가 남아 있지 않다.
- `TODO`, `test.skip`, 빈 스텁, 고정 화면 데이터를 완료로 보고하지 않는다.

## 빌드·실행·검증

```bash
cd frontend
npm install
npm run dev         # http://localhost:8083
npm run lint
npm run typecheck
npm run test
npm run build       # 정적 산출물(독립 배포)
```

- 개발 시 Vite dev 서버(8083)가 `/api`·WS를 Spring(8080)으로 프록시. **통합 빌드 없음**(FE/BE 분리 — [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)).
- 완료 보고에는 변경한 사용자 흐름, Interface, Mock, HTTP 매핑, Query/Mutation 연결, 백엔드 필요사항, 계약·ADR 변경, 검증 결과와 남은 제한사항을 포함한다.
- 저장소 루트에서 `git diff --check`도 실행한다. 실제 백엔드를 실행하지 못했다면 HTTP 계약 테스트 결과와 실제 연동 미검증 사실을 구분해 보고한다.
