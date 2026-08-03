#!/usr/bin/env bash
# 번호 충돌 가드 — Flyway 마이그레이션과 ADR.
#
# 왜 필요한가
#   두 브랜치가 각자 **같은 번호**를 집으면(예: 둘 다 V21__*.sql, 파일명은 다름) git은 파일명이
#   달라 충돌 없이 병합한다. 그런데 Flyway는 기동할 때 "Found more than one migration with
#   version N"으로 거부한다 → 백엔드가 crash loop. 실제로 2026-07-31과 2026-08-03에 이 조합으로
#   운영이 내려갔다. ADR도 같은 방식으로 겹치는데(2026-08-03 songjeongki/0064 두 개), 이쪽은
#   기동을 막지는 않고 "ADR-0064"라는 참조가 어디를 가리키는지 알 수 없게 만든다.
#
#   MR 파이프라인은 소스 브랜치에서 돈다. 각 브랜치엔 그 번호가 하나뿐이라 테스트로는 잡히지
#   않는다 — 충돌은 병합 결과에서만 드러난다. 그래서 "대상 브랜치와 대조"하는 검사가 필요하다.
#
# 무엇을 하는가 (마이그레이션·ADR 각각)
#   1) 내 브랜치 안에 같은 번호가 둘 이상 있는지
#   2) 내가 새로 집은 번호가 이미 대상 브랜치(기본 origin/master)에 있는지
#
#   ADR은 **저자 폴더별로** 번호를 매긴다(docs/decisions/<저자>/NNNN-*.md). 그래서 폴더가 다르면
#   같은 번호여도 충돌이 아니다 — 실제로 seominkyeong/0064와 songjeongki/0064는 공존한다.
#
# 이 검사만으로는 부족하다
#   CI가 통과한 뒤 머지되기 전에 대상 브랜치가 바뀌면 이 검사는 그 변화를 보지 못한다. 2026-08-03의
#   V21 사고가 정확히 그 창에서 났다. 그 창은 검사로 닫을 수 없어서 프로젝트 설정
#   (Merge method = 반선형 이력)으로 닫는다 — 대상 브랜치가 앞서 있으면 rebase를 강제하고,
#   rebase가 파이프라인을 다시 돌려 이 검사가 새 master를 보게 된다. ADR-0069.
#
# 고치는 법
#   이미 적용/머지된 쪽은 그대로 두고, **내 번호만** 비어 있는 다음 번호로 올린다. 운영에 이미
#   적용된 마이그레이션의 번호를 바꾸면 flyway_schema_history와 어긋나 더 크게 깨진다.

set -euo pipefail

TARGET_REF="${1:-origin/master}"
MIGRATION_DIR="backend/src/main/resources/db/migration"
DECISION_DIR="docs/decisions"

failures=""
note() { failures+="$*"$'\n'; }
warnings=""
warn() { warnings+="$*"$'\n'; }

# 파일명에서 번호를 뽑는다. Vnn__x.sql → nn, nnnn-x.md → nnnn.
number_of() {
  basename "$1" | sed -nE -e 's/^V([0-9]+)__.*\.sql$/\1/p' -e 's/^([0-9]{4})-.*\.md$/\1/p'
}

# 한 "번호 공간"을 검사한다. 번호 공간 = 번호가 유일해야 하는 디렉터리 하나.
#   $1 라벨(사람이 읽을 이름)  $2 디렉터리  $3 파일 glob
#
# 실패는 **이 브랜치가 새로 만든 충돌**에 한한다. 대상 브랜치에 이미 있던 중복까지 실패로 다루면
# 남이 남긴 것 때문에 모든 MR이 막힌다 — 그건 경고로만 알리고, 고칠지는 그 주인이 정한다.
check_space() {
  local label="$1" dir="$2" glob="$3"
  [ -d "$dir" ] || return 0

  local -A mine=()
  local -a dup_pairs=()
  local path v
  for path in "$dir"/$glob; do
    [ -e "$path" ] || continue
    v="$(number_of "$path")"
    [ -n "$v" ] || continue
    if [ -n "${mine[$v]:-}" ]; then
      dup_pairs+=("$v|$(basename "${mine[$v]}")|$(basename "$path")")
    fi
    mine[$v]="$path"
  done

  git rev-parse --verify --quiet "$TARGET_REF" >/dev/null || return 0

  # 대상 브랜치의 파일명 집합 + 번호→파일명.
  local -A target_names=() target_by_num=()
  local name
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    target_names["$name"]=1
    v="$(number_of "$name")"
    [ -n "$v" ] && target_by_num[$v]="$name"
  done < <(git ls-tree --name-only "$TARGET_REF" "$dir/" | xargs -r -n1 basename)

  # 브랜치 내 중복: 둘 다 대상에 이미 있으면 기존 문제(경고), 하나라도 새 것이면 이 브랜치 탓(실패).
  local entry a b new_dup="" old_dup=""
  for entry in ${dup_pairs[@]+"${dup_pairs[@]}"}; do
    v="${entry%%|*}"; a="${entry#*|}"; b="${a#*|}"; a="${a%%|*}"
    if [ -n "${target_names[$a]:-}" ] && [ -n "${target_names[$b]:-}" ]; then
      old_dup+="    $v: $a / $b"$'\n'
    else
      new_dup+="    $v: $a / $b"$'\n'
    fi
  done
  [ -n "$new_dup" ] && note "❌ [$label] 이 브랜치가 같은 번호를 둘 이상 씁니다:"$'\n'"$new_dup"
  [ -n "$old_dup" ] && warn "⚠️  [$label] 대상 브랜치에 이미 있는 중복(이 MR이 만든 것 아님):"$'\n'"$old_dup"

  # 대상이 이미 쓰는 번호를 다른 파일명으로 다시 집었는가 — 병합되면 둘이 공존한다.
  local conflict=""
  for v in "${!mine[@]}"; do
    a="$(basename "${mine[$v]}")"
    b="${target_by_num[$v]:-}"
    [ -n "$b" ] && [ -z "${target_names[$a]:-}" ] && conflict+="    $v: 내 브랜치 '$a'  ↔  $TARGET_REF '$b'"$'\n'
  done
  [ -n "$conflict" ] && note "❌ [$label] 대상 브랜치가 이미 쓰고 있는 번호입니다:"$'\n'"$conflict"

  return 0
}

check_space "Flyway 마이그레이션" "$MIGRATION_DIR" 'V*__*.sql'

# ADR은 저자 폴더별 번호 공간이다 — 폴더가 다르면 같은 번호여도 충돌이 아니다.
if [ -d "$DECISION_DIR" ]; then
  for author_dir in "$DECISION_DIR"/*/; do
    [ -d "$author_dir" ] || continue
    check_space "ADR ${author_dir#"$DECISION_DIR"/}" "${author_dir%/}" '[0-9][0-9][0-9][0-9]-*.md'
  done
fi

if ! git rev-parse --verify --quiet "$TARGET_REF" >/dev/null; then
  echo "⚠️  $TARGET_REF 를 찾을 수 없어 대상 브랜치 비교를 건너뜁니다(브랜치 내부 중복만 검사)."
fi

[ -n "$warnings" ] && printf '%s' "$warnings" >&2

if [ -n "$failures" ]; then
  printf '%s' "$failures" >&2
  echo "이미 적용/머지된 쪽은 두고, 내 번호만 비어 있는 다음 번호로 올리세요." >&2
  exit 1
fi

echo "✅ 번호 충돌 검사 통과 (Flyway·ADR, 브랜치 내 중복 없음, $TARGET_REF 와 충돌 없음)."
