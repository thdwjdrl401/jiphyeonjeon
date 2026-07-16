## 📝 Summary

프론트엔드 인증 식별자를 `loginId`에서 `email`로 전환했습니다.
로그인·회원가입 화면, fixture, 실제 API 어댑터와 계약 테스트를 같은 기준으로 동기화하고,
회원가입의 `displayName` 입력 항목을 닉네임으로 명확하게 표시했습니다.

## ✅ Checklist

- ~[ ] 관련 이슈가 명시되어 있습니다.~
- [x] 테스트가 완료되었습니다.
- [ ] 문서 업데이트가 포함되었습니다.
- [x] 코드 리뷰를 위한 사전 검토를 완료했습니다.

### 🔒 하네스 체크리스트

- [x] **계약 검증**: 이메일 기반 로그인·회원가입 요청 필드와 이메일 중복 확인 API 경로를 테스트로 검증했습니다.
      - 증거: Vitest 1개 파일, 7개 테스트 통과
- ~[ ] **결정 기록**: 기술 결정·판단(라이브러리·🟡 항목·테스트 채택/생략 등)이 있으면 `docs/decisions/`에 ADR 기록.~
      - ADR 번호: 해당 없음 — 신규 기술 선택 없이 확정된 이메일 로그인 요구사항을 반영했습니다.
- [ ] **필드명 camelCase** 준수 (snake 응답 없음). 계약 변경 시 CONTRACT.md·FE/BE 양쪽 반영.
      - `email`, `displayName` 등 프론트 필드는 camelCase를 준수했습니다.
      - 백엔드와 계약 문서 동기화는 후속 작업이 필요합니다.
- [ ] **문서 최신화**: 규칙/판단 로직 변경은 정본(AGENTS/POLICY/CONTRACT)에만 반영(어댑터 복제 금지). 문서 이동·삭제 시 링크 정상(`node docs/harness/templates/check-links.mjs`).
      - 현재 `docs/frontend/api/API_MAP.md`에는 기존 `loginId` 계약이 남아 있습니다.
- [x] **가짜 완료 없음**: TODO / `test.skip` / `@Disabled` / 빈 스텁을 완료로 포함하지 않음.

## 📄 Description

### 인증 모델 및 API 어댑터

- `AuthUser`, 로그인 요청, 회원가입 요청의 식별자를 `email`로 변경했습니다.
- 로그인 요청을 `POST /api/v1/auth/login`의 `{ email, password }` 형태로 변경했습니다.
- 회원가입 요청을 `POST /api/v1/auth/signup`의 `{ email, password, displayName, role }` 형태로 변경했습니다.
- 이메일 중복 확인을 `GET /api/v1/auth/email-availability?email=...`로 분리했습니다.
- 실제 API와 fixture가 동일한 타입과 오류 코드(`AUTH_EMAIL_DUPLICATED`)를 사용하도록 맞췄습니다.

### 로그인 및 회원가입 화면

- 로그인 입력을 이메일 타입으로 변경하고 필수값·이메일 형식·최대 320자를 검증합니다.
- 회원가입에 이메일 중복 확인과 이메일 변경 시 확인 상태 초기화를 적용했습니다.
- `displayName`은 API 필드명을 유지하면서 화면에서는 닉네임으로 표시하고 2–100자로 검증합니다.
- fixture에서는 `instructor@liveclass.ai`로 강사 로그인 화면을 확인할 수 있습니다.

### 테스트 및 검증

- `npm.cmd run lint` 통과
- `npm.cmd run typecheck` 통과
- `npm.cmd --prefix frontend run test` 통과 — 7 tests
- `npm.cmd --prefix frontend run build` 통과
- 변경 diff에서 TODO, `test.skip`, `@Disabled`, 빈 스텁이 없음을 확인했습니다.

## 💡 Notice (Optional)

- 백엔드 인증 API가 대부분 미구현 상태이므로 현재 프론트엔드는 fixture로 동작합니다.
- 실제 API 연동 전에 백엔드 요청·응답 DTO와 이메일 중복 확인 경로를 동일하게 구현해야 합니다.
- `docs/frontend/api/API_MAP.md`의 `loginId` 및 `/auth/login-id-availability` 명세가 현재 프론트 구현과 다릅니다.
- 공유 계약 확정 시 `docs/CONTRACT.md`, 프론트엔드, 백엔드와 API 명세를 한 변경에서 동기화해야 합니다.
- 로컬에 스테이징되어 있던 `frontend/.env` 변경은 커밋 `bd975fa`에 포함하지 않았습니다.

## 🔗 Related Issue(s)

해당 없음
