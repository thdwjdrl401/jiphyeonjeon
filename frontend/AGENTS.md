# AGENTS.md — Frontend (Vue 3)

> 📍 정본 규칙: [../AGENTS.md](../AGENTS.md) · 공유 계약: [../docs/CONTRACT.md](../docs/CONTRACT.md) · 판단 정책: [../docs/harness/POLICY.md](../docs/harness/POLICY.md)
>
> 이 파일은 frontend 작업 시의 스택별 규칙만 다룹니다. 계약·완료 게이트·커밋 규칙은 정본을 따르세요.

## 스택·환경
- Vue **3.4** · Vite **5** · Element Plus · Vue Router 4 · Vuex 4 · Axios. Node.js 20.18 LTS.
- 개발 서버 8083, 빌드 산출물은 backend 정적 리소스로 번들.

## 구조 (`frontend/src`)
```
App.vue · main.js
views/    ← 화면
store/    ← Vuex (토큰·세션·방 목록 등)
common/   ← 공용 모듈 (axios 인스턴스, WebSocket 등)
assets/
```

## 계약 준수 (FE가 지킬 것)
- BE 응답을 소비할 때 **camelCase** 필드 가정([CONTRACT §1](../docs/CONTRACT.md#1-필드명-규칙--camelcase-통일)). snake 필드가 오면 계약 위반 → BE와 함께 정정(FE에서 변환 우회 금지).
- **공용 Axios**: 토큰 존재 시 `Authorization: Bearer`. 401(세션무효/만료)·403 처리 규칙은 [SPEC §6](../docs/SPEC.md).
- 토큰 localStorage 저장, 진입 시 `/api/v1/users/me`로 로그인/비로그인 분기.

## 빌드·실행·린트
```bash
cd frontend
npm install        # 최초 1회
npm run dev        # http://localhost:8083
npm run build      # 프로덕션 빌드
npm run lint       # ESLint (--fix). 설정은 package.json의 eslintConfig
```
- 루트에서 FE+BE 동시: `npm run dev` (레포 루트).

## 자물쇠 활성화 (필요 시)
camelCase 강제 등 린트 규칙 강화는 [../docs/harness/ENFORCEMENT.md](../docs/harness/ENFORCEMENT.md)와 `docs/harness/templates/eslint-camelcase.rules.jsonc` 템플릿을 따른다.
