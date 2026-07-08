# CLAUDE.md

> **먼저 [AGENTS.md](AGENTS.md)를 읽으세요.** 프로젝트 규칙·공유 계약·완료 게이트의 정본은 AGENTS.md이며,
> Claude Code에도 그대로 적용됩니다. 이 파일은 Claude Code 전용 편의 기능만 다룹니다.

## Claude Code 전용

- **디렉토리 진입 시 자동 로드**: `backend/`·`frontend/`에서 작업하면 각 폴더의 `AGENTS.md`가 함께 적용됩니다.
- **슬래시 명령** (`.claude/commands/`):
  - `/harness-check <기능>` — 이 기능에 계약 테스트/린트가 필요한지 [POLICY](docs/harness/POLICY.md) 기준으로 판단하고 근거를 출력. 필요 시 ADR 초안 생성.
  - `/run` — FE+BE 동시 실행 (루트 `npm run dev`).
  - `/review` — 변경분 리뷰.
- **서브에이전트** (`.claude/agents/`): `harness-judge` — 판단 전담(별도 레인에서 리뷰어처럼 사용).
- **공유 설정**: `.claude/settings.json`은 팀 공용(커밋). 개인 설정은 `.claude/settings.local.json`(git 무시).

## 완료 전 체크 (AGENTS.md §4 재확인)

1. 계약 걸린 기능이면 테스트 통과 증거, 아니면 불필요 근거 한 줄.
2. 기술 결정/판단은 `docs/decisions/`에 ADR 남기고 번호 명시.
3. `TODO`/`@Disabled`/빈 스텁을 완료로 보고하지 않기.
