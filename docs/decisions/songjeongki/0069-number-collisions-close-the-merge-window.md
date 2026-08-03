# ADR-0069: 번호 충돌은 검사로 못 막는다 — rebase를 강제해 머지 창을 닫는다

> 관련 결정: [ADR-0038 CI 테스트 게이트](0038-ci-test-gate-testcontainers.md) ·
> [기여 규칙 §5 브랜치·커밋·MR](../../../AGENTS.md)

- **상태**: 채택 — 구현됨(`scripts/check-version-collisions.sh`, CI `check-collisions`, 프로젝트 Merge method)
- **일자**: 2026-08-03
- **적용 범위**: Flyway 마이그레이션 번호, ADR 번호, GitLab 프로젝트 머지 설정

## 한 줄 결정

번호 충돌 검사는 **Flyway와 ADR 둘 다** 대상으로 하고, 검사가 구조적으로 못 보는 "CI 통과 뒤
머지 전" 창은 **Merge method를 반선형 이력(rebase 강제)으로 바꿔** 닫는다.

## 맥락

### 1. 같은 사고가 하루에 두 번 났다

**2026-08-03 12:26 — 운영 중단(29분).** 용어집 MR과 강의 삭제 MR이 각자 `V21__*.sql`을 추가했다.
파일명이 달라 git은 조용히 병합했고, Flyway가 기동을 거부했다.

```
Found more than one migration with version 21
-> V21__lesson_glossary_override.sql
-> V21__denormalized_fk_on_delete_cascade.sql
```

**같은 날, 같은 두 MR이 `songjeongki/0064`도 함께 집었다.** 이쪽은 기동을 막지 않지만
"ADR-0064"라는 참조가 어디를 가리키는지 알 수 없게 만든다.

### 2. 가드는 있었는데 못 잡았다

2026-07-31 사고 뒤에 `check-flyway-versions.sh`를 만들어 두었다. 그런데 이번엔 통과했다.

가드는 **잡이 도는 시점의** 대상 브랜치와 대조한다. 순서가 이랬다:

```
12:15  내 MR CI 실행 → 그때 master에는 V21이 없다 → 통과
12:16  용어집 MR 머지 → master에 V21 생김
12:17  내 MR 머지 → V21 두 개
```

**검사와 머지 사이에 대상 브랜치가 움직였다.** 어떤 사전 검사도 이 창을 닫을 수 없다 — 검사가
끝난 뒤의 변화는 정의상 볼 수 없기 때문이다.

### 3. 창을 닫는 수단이 CE에는 제한적이다

merged results 파이프라인과 머지 트레인이 이 창을 위한 기능이지만, **둘 다 Premium이다.**
우리 인스턴스는 Community Edition이다(`/api/v4/version` → `enterprise: false`). 쓸 수 없다.

## 결정

### (1) 검사 대상을 넓힌다

`check-flyway-versions.sh` → **`check-version-collisions.sh`**. Flyway와 ADR을 같은 규칙으로 본다.
ADR은 **저자 폴더별 번호 공간**이라 폴더가 다르면 같은 번호여도 충돌이 아니다(실제로
`seominkyeong/0064`와 `songjeongki/0064`는 정상 공존한다).

**실패는 이 브랜치가 새로 만든 충돌에 한한다.** 대상 브랜치에 이미 있던 중복까지 실패로 다루면
남이 남긴 것 때문에 모든 MR이 막힌다 — 그건 경고로만 알리고 고칠지는 주인이 정한다. 지금
`canola/0037`이 그 상태다.

### (2) 머지 창은 rebase 강제로 닫는다

프로젝트 **Merge method를 "Merge commit with semi-linear history"(`rebase_merge`)** 로 바꾼다.
대상 브랜치가 앞서 있으면 GitLab이 머지를 거부하고 rebase를 요구한다. rebase는 새 커밋을
만들므로 파이프라인이 다시 돌고, "파이프라인 성공해야 머지"(이미 켜져 있다)와 맞물려
**검사가 항상 최신 master를 보고 다시 판정한다.** 창이 사라진다.

머지 커밋은 그대로 남는다 — 지금 쓰는 이력 모양이 바뀌지 않는다.

## 대안과 기각 사유

| 대안 | 기각 사유 |
|---|---|
| merged results 파이프라인 / 머지 트레인 | **CE에 없다.** Premium 전용 |
| `merge_method: ff`(fast-forward) | 창은 닫히지만 머지 커밋이 사라져 이력 모양이 통째로 바뀐다. 필요 이상 |
| 타임스탬프 마이그레이션 번호(`V20260803120000__`) | Flyway 쪽 충돌은 사라지지만 ADR엔 안 통하고, 번호로 순서를 읽던 관행이 깨진다. 얻는 것 대비 개정 범위가 크다 |
| 머지 직전 사람이 다시 확인 | 오늘 두 번 다 사람이 놓쳤다. 규칙으로 만들 수 없는 것을 규칙이라 부르지 않는다 |

## 결과

- 오늘의 두 사고를 재현해 **둘 다 실패로 잡히는 것**을 확인했다(V21 중복, `songjeongki/0064` 중복).
- MR을 머지하려면 대상 브랜치 기준으로 최신이어야 한다. **가끔 "Rebase" 버튼을 누르게 된다.**
- 러너가 한 대라 rebase마다 파이프라인이 다시 돈다. 열린 MR이 많으면 대기가 생긴다 — 운영을
  29분 내리는 것보다 싸다고 본다.
- `canola/0037` 중복은 경고로 남는다. 남의 폴더라 임의로 개번하지 않는다.
