# ENFORCEMENT.md — 자물쇠(강제) 활성화 가이드

> 📍 하네스 개요: [README.md](README.md) · 판단 정책: [POLICY.md](POLICY.md)
>
> **지금은 비활성입니다.** 이 문서는 "채울 자리와 켜는 법"만 정의합니다.
> 기능 착수 시 [POLICY](POLICY.md)로 필요하다고 판단한 자물쇠만, 아래 절차대로 켜세요.
> 모든 템플릿은 [templates/](templates/)에 있으며 **컴파일·린트 대상이 아니라 빌드를 깨지 않습니다.**

---

## A. 프론트엔드 camelCase 린트 (Sub Ⅱ 착수 시)

FE는 `npm run lint`(ESLint)가 이미 동작하고 규칙은 `frontend/package.json`의 `eslintConfig.rules`가 비어 있습니다. camelCase 강제를 켜려면:

1. [templates/eslint-camelcase.rules.jsonc](templates/eslint-camelcase.rules.jsonc)의 규칙을 `frontend/package.json`의 `eslintConfig.rules`에 병합.
2. 확인: `cd frontend && npm run lint` → snake_case 식별자에서 경고/에러.

## B. Git pre-commit 훅 (린트 자동 실행, 도구 무관)

누가 어떤 AI로 짰든 커밋 시점에 검증되게 합니다. Husky + lint-staged 사용.

```bash
# 레포 루트에서 (최초 1회)
npm install -D husky lint-staged
npx husky init
# 아래 pre-commit 훅 생성
echo "npx lint-staged" > .husky/pre-commit
```

루트 `package.json`에 lint-staged 설정 추가:
```jsonc
"lint-staged": {
  "frontend/**/*.{ts,tsx,js,cjs,mjs}": "npm --prefix frontend run lint"
}
```

> ⚠️ **Windows 주의**: husky 훅은 Git Bash에서 실행됩니다. 부트캠프 Windows 환경에서 `git commit`이 PowerShell/CMD여도 훅은 sh로 돕니다. 문제 시 `git config core.hooksPath .husky` 확인.
> 지금 켜지 않는 이유: 아직 린트로 잡을 소스가 거의 없어 헛돕니다. Sub Ⅱ 착수와 함께 켭니다.

## C. 백엔드 계약 테스트 (Sub Ⅰ/Ⅱ 착수 시)

1. `backend/src/test/java/com/liveclass/` 생성 후 [templates/ContractTestTemplate.java](templates/ContractTestTemplate.java)를 복사.
2. `@Disabled`를 제거하고 대상 엔드포인트(예: `POST /users` → 201, 방 응답 필드명 camelCase)를 채움.
3. `build.gradle`의 `dependencies`에 테스트 의존성 확인/추가:
   `testImplementation 'org.springframework.boot:spring-boot-starter-test'`
4. 확인: `cd backend && ./gradlew test`.

## D. 백엔드 정적 검사 Checkstyle/Spotless (선택, 후속)

경량 도입 예시(`backend/build.gradle`):
```gradle
// plugins { id 'com.diffplug.spotless' version '6.25.0' }
// spotless { java { googleJavaFormat() } }
```
지금은 주석 예시만. 팀 합의 후 활성화하고 근거는 [decisions/](../decisions/)에 ADR.

## E. CI (GitHub Actions, 후속·2차 방어선)

로컬 훅을 우회한 경우를 위한 2차 방어선. [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)이 프런트 lint·타입체크·vitest와 백엔드 gradle test, 그리고 번호 충돌 검사(`대상 브랜치와 대조`)를 돌립니다. 로컬 훅(B)이 1차, CI가 2차입니다.

## F. 도구별 어댑터 (설치 완료 — 추가 작업 없음)

정본 `AGENTS.md`·`POLICY.md`에 연결되는 도구별 어댑터가 이미 설치돼 있습니다. 각 도구를 쓰면 바로 활성화됩니다.

| 도구 | 포인터(규칙) | 명령 어댑터 |
|---|---|---|
| Claude Code | `CLAUDE.md` | `.claude/commands/*.md`, `.claude/agents/harness-judge.md` |
| Cursor | `.cursor/rules/harness.mdc` | `.cursor/commands/harness-check.md` |
| Gemini CLI | `GEMINI.md` | `.gemini/commands/harness-check.toml` |
| Codex | `AGENTS.md`(네이티브) | 별도 명령 없음(문서 기반) |

**어댑터 주의사항** (⚠️ 지키지 않으면 표류):
- 어댑터는 **얇은 포인터/리모컨**이다. **규칙·판단 기준을 어댑터 안에 복제하지 말 것** — 알맹이는 `POLICY.md`·`CONTRACT.md`·`AGENTS.md`에만 둔다. 판단 로직이 바뀌면 어댑터가 아니라 이 문서들을 고친다.
- 각 도구는 **읽는 파일이 다르다**. 새 규칙은 반드시 정본 문서에 추가하고, 어댑터는 그대로 둔다.
- **권한/설정은 도구별이라 공유되지 않는다** (`.claude/settings.json` ≠ Cursor/Gemini 설정). 규칙이 아니라 각자 권한이므로 정상.
- 도구가 설정 포맷을 바꾸면(예: Cursor 명령 경로) 어댑터를 해당 도구 공식 문서에 맞춰 갱신한다.

---

## G. 문서 최신화 자물쇠 (표류 방지)

문서가 코드·서로에 대해 뒤처지지 않게 하는 제약. **동기화 규칙**([AGENTS.md §7](../../AGENTS.md#7-문서-최신화-규칙-표류-방지))이 사람용 규칙이라면, 아래는 기계 검사다.

### G-1. 깨진 링크 검사 (즉시 활성 권장, 저비용)
문서 삭제·이동으로 참조가 끊기면 커밋에서 막는다. 스크립트: [templates/check-links.mjs](templates/check-links.mjs).
```bash
node docs/harness/templates/check-links.mjs   # 깨진 링크 있으면 exit 1
```
pre-commit 훅(§B)에 한 줄 추가:
```bash
node docs/harness/templates/check-links.mjs || exit 1
```

### G-2. 계약 동반수정 검사 (Sub Ⅱ 착수 시)
API 요청/응답 모델을 바꿨는데 `docs/CONTRACT.md`를 안 고쳤으면 경고 → 계약 문서가 코드에 뒤처지는 것을 막는다. pre-commit/CI 예시:
```bash
CHANGED=$(git diff --cached --name-only)
if echo "$CHANGED" | grep -qE 'backend/.*/(request|response)/|frontend/src/(store|common)/'; then
  echo "$CHANGED" | grep -q 'docs/CONTRACT.md' \
    || echo "⚠️  API 계약 관련 파일이 바뀌었습니다. docs/CONTRACT.md 갱신이 필요한가요? (필요없으면 무시)"
fi
```
> 차단이 아니라 **상기(reminder)**로 시작 — 오탐 마찰을 줄이고, 진짜 계약 변경만 CONTRACT/ADR로 유도.

### G-3. 리뷰 게이트 (이미 활성)
- 공유 문서 변경은 [CODEOWNERS](../../CODEOWNERS)로 리드 승인 필수.
- [PR 체크리스트](../../.github/PULL_REQUEST_TEMPLATE.md)의 계약·ADR·문서 항목.

## 활성화 체크리스트

- [ ] POLICY로 이 기능에 필요한 자물쇠 판단함
- [ ] 해당 템플릿을 복사·채움 (`@Disabled`/주석 제거)
- [ ] 로컬에서 통과 확인 (`npm run lint` / `./gradlew test`)
- [ ] 판단 근거를 ADR로 기록 ([decisions/](../decisions/))
