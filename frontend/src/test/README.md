# 프론트엔드 테스트 구조

프론트 테스트는 이 디렉터리를 단일 진입점으로 사용한다. 구현 코드 옆에는 `*.test.ts(x)`를 두지 않는다.

```text
test/
├── setup.ts       # 모든 Vitest 파일에 공통으로 적용되는 환경 초기화
├── features/      # 한 feature의 서비스·순수 함수·컴포넌트 테스트
├── shared/        # 공용 API·유틸리티 테스트
└── integration/   # 라우터와 여러 feature를 함께 렌더링하는 사용자 흐름 테스트
```

## 배치 기준

- 특정 feature가 소유한 동작은 `features/<feature>/`에 둔다.
- 공용 인프라와 유틸리티는 `shared/`에 둔다.
- 실제 `App`과 라우터를 렌더링하거나 여러 feature 상태를 함께 검증하면 `integration/`에 둔다.
- 중앙 테스트 디렉터리에서 구현 코드를 가져올 때는 `@/` alias를 사용한다.
- 파일은 테스트 대상 또는 책임별로 분리하고 하나의 거대한 테스트 파일로 합치지 않는다.

## 실행

```bash
npm run test
```

Vitest가 이 디렉터리 아래의 `*.test.ts`, `*.test.tsx`를 자동으로 탐색한다.
