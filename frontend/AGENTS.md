# AGENTS.md — Frontend (React + TypeScript)

> 📍 정본 규칙: [../AGENTS.md](../AGENTS.md) · 공유 계약: [../docs/CONTRACT.md](../docs/CONTRACT.md) · 판단 정책: [../docs/harness/POLICY.md](../docs/harness/POLICY.md)
>
> 이 파일은 frontend 작업 시의 스택별 규칙만 다룹니다. 계약·완료 게이트·커밋 규칙은 정본을 따르세요.

## 스택·환경

- React **19** · TypeScript · Vite · React Router · **TanStack Query**(서버 상태) · 최소 전역 UI 상태(Context/Zustand) · Axios. Node.js 20.18 LTS.
- AI 응답은 **SSE**, 채팅/자막은 **WebSocket**(누락은 REST로 보완). API 타입은 OpenAPI 생성 권장(임의 DTO 복제 금지).
- 개발 서버 8083. **FE/BE 분리 배포** — React를 독립 서비스(정적 호스팅/컨테이너)로 배포, Spring은 API+WS만([../docs/decisions/0002](../docs/decisions/0002-react-typescript-frontend.md)).
- UI 프레임워크 없이 기존 CSS와 네이티브 HTML 요소를 사용.

## 구조 (`frontend/src`)

```text
App.tsx · main.tsx
pages/              ← 라우트 화면
components/         ← 공용·레이아웃 컴포넌트
contexts/           ← 인증·메뉴 전역 상태
api/                ← Axios 인스턴스·API 호출
config/ · types/    ← 메뉴 설정·공유 TypeScript 타입
styles/ · assets/
test/               ← Vitest/React Testing Library
```

## 계약 주의 (FE가 지킬 것)

- BE 응답을 소비할 때 **camelCase** 필드 계약을 따른다([CONTRACT §1](../docs/CONTRACT.md#1-필드명-규칙--camelcase-통일)). snake 필드가 오면 BE와 함께 정정하며 FE 변환 우회는 금지.
- 공용 Axios는 `/api/v1`을 base URL로 사용하고 토큰 존재 시 `Authorization: Bearer <token>`을 보낸다.
- 토큰은 `localStorage`의 `accessToken`에 저장한다. 401·403 및 `/users/me` 진입 검증은 [SPEC §6](../docs/SPEC.md)의 후속 구현 범위다.

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

- 개발 시 Vite dev 서버(8083)가 `/api/v1`·WS를 Spring(8080)으로 프록시. **통합 빌드 없음**(FE/BE 분리 — [../docs/architecture.md](../docs/architecture.md)).
