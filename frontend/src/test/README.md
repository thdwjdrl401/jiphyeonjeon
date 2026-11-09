# 프론트엔드 테스트 구조

프론트 테스트는 이 디렉터리를 단일 진입점으로 사용한다. 구현 코드 옆에는 `*.test.ts(x)`를 두지 않는다.

```text
test/
├── setup.ts       # 모든 Vitest 파일에 공통으로 적용되는 환경 초기화
├── features/      # 한 feature의 서비스·순수 함수·컴포넌트 테스트
├── shared/        # 공용 API·유틸리티 테스트
├── pages/         # 페이지 단위 렌더링 테스트(`src/pages/` 대응)
└── integration/   # 라우터와 여러 feature를 함께 렌더링하는 사용자 흐름 테스트
```

## 배치 기준

- 특정 feature가 소유한 동작은 `features/<feature>/`에 둔다.
- 공용 인프라와 유틸리티는 `shared/`에 둔다.
- 실제 `App`과 라우터를 렌더링하거나 여러 feature 상태를 함께 검증하면 `integration/`에 둔다.
- 중앙 테스트 디렉터리에서 구현 코드를 가져올 때는 `@/` alias를 사용한다.
- 파일은 테스트 대상 또는 책임별로 분리하고 하나의 거대한 테스트 파일로 합치지 않는다.

## 간헐 실패를 만들지 않는 규칙

간헐적으로 떨어지는 테스트는 고장을 감추고, 무엇보다 **다음 사람이 자기 변경을 의심하게 만든다.**
실제로 겪은 것만 적는다.

### 노드를 붙잡아 뒀다가 다시 보지 않는다

```ts
// ✗ 찾은 시점과 확인하는 시점이 갈린다
expect(await screen.findByRole('heading', { name: '강의 제목' })).toBeInTheDocument()

// ✓ findBy는 없으면 스스로 실패한다. 덧붙일 이유가 없다
await screen.findByRole('heading', { name: '강의 제목' })
```

뮤테이션이 `invalidateQueries` 뒤에 곧바로 이동하는 흐름에서 실제로 터졌다. 화면이 한 번 그려진
뒤 재조회 결과가 도착하면 트리를 다시 그리는데, 그때 붙잡아 둔 노드가 문서에서 떨어진다.
**"찾았는데 문서에 없다"**는 모순된 실패라 원인을 짚기 어렵고, 기다림이 모자란 것이 아니라서
`timeout`을 늘려도 그대로다.

### 기다림이 모자란 것인지 먼저 확인한다

`timeout`부터 늘리면 진짜 원인이 덮인다. 실패 메시지를 본다.

- `TestingLibraryElementError: Unable to find...` → 정말 안 나타났다. 느린 것일 수 있다.
- `expect(element).toBeInTheDocument()` 실패 → **찾긴 찾았다.** 위의 노드 교체를 의심한다.

### 이벤트 구독을 가짜로 만들 때는 해당 핸들러만 제거한다

```ts
// ✗ 다른 구독자까지 지운다 — 이 이벤트를 쓰는 코드가 늘면 무관한 테스트가 깨진다
removeEventListener: () => { listeners.splice(0, listeners.length) }

// ✓ 실제 API와 같게
removeEventListener: (_: string, handler: () => void) => {
  const index = listeners.indexOf(handler)
  if (index >= 0) listeners.splice(index, 1)
}
```

## 실행

```bash
npm run test
```

Vitest가 이 디렉터리 아래의 `*.test.ts`, `*.test.tsx`를 자동으로 탐색한다.
