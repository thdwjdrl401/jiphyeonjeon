#!/usr/bin/env bash
# Flyway 마이그레이션 버전 충돌 가드.
#
# 왜 필요한가
#   두 브랜치가 각자 새 마이그레이션을 **같은 버전 번호**로 추가하면(예: 둘 다 V11__*.sql, 파일명은 다름)
#   git은 파일명이 달라 충돌 없이 병합한다. 그런데 Flyway는 기동할 때
#   "Found more than one migration with version N"으로 거부한다 → 백엔드가 crash loop.
#   실제로 2026-07-31에 이 조합으로 운영이 내려갔고, 공유 dev DB에서도 같은 일이 있었다
#   (V16__repair_live_session_annotation_visible.sql의 주석이 그 경위를 남기고 있다).
#
#   MR 파이프라인은 **소스 브랜치**에서 돌기 때문에(merged results 미사용) 각 브랜치엔 그 번호가
#   하나뿐이라 통과한다. 충돌은 병합 결과에서만 드러나고, 그때는 이미 master가 깨져 있다.
#
# 무엇을 하는가
#   1) 내 브랜치의 마이그레이션 안에 같은 버전이 둘 이상 있는지
#   2) 내가 **새로 추가한** 버전이 이미 대상 브랜치(기본 origin/master)에 있는지
#   둘 중 하나라도 걸리면 실패한다. 대상 브랜치와 병합해 보지 않고도 잡히므로 타이밍에 좌우되지 않는다.
#
# 고치는 법
#   이미 적용된 쪽(대상 브랜치)은 그대로 두고, **내 마이그레이션 번호만** 비어 있는 다음 번호로 올린다.
#   운영에 이미 적용된 마이그레이션의 번호를 바꾸면 flyway_schema_history와 어긋나 더 크게 깨진다.

set -euo pipefail

TARGET_REF="${1:-origin/master}"
MIGRATION_DIR="backend/src/main/resources/db/migration"

fail() { echo "❌ $*" >&2; exit 1; }

version_of() { basename "$1" | sed -nE 's/^V([0-9]+)__.*/\1/p'; }

# --- 1) 브랜치 안에서의 중복 -------------------------------------------------
declare -A seen_in_branch=()
duplicates=""
for path in "$MIGRATION_DIR"/V*__*.sql; do
  [ -e "$path" ] || continue
  v="$(version_of "$path")"
  [ -n "$v" ] || continue
  if [ -n "${seen_in_branch[$v]:-}" ]; then
    duplicates+="  V$v: $(basename "${seen_in_branch[$v]}") / $(basename "$path")"$'\n'
  fi
  seen_in_branch[$v]="$path"
done
if [ -n "$duplicates" ]; then
  fail $'같은 버전의 마이그레이션이 이 브랜치 안에 둘 이상 있습니다.\n'"$duplicates"
fi

# --- 2) 대상 브랜치와의 충돌 -------------------------------------------------
if ! git rev-parse --verify --quiet "$TARGET_REF" >/dev/null; then
  echo "⚠️  $TARGET_REF 를 찾을 수 없어 대상 브랜치 비교를 건너뜁니다(브랜치 내부 중복만 검사)."
  echo "✅ Flyway 버전 검사 통과(부분)."
  exit 0
fi

# 대상 브랜치에 이미 있는 버전 → 파일명
declare -A target_versions=()
while IFS= read -r name; do
  [ -n "$name" ] || continue
  v="$(version_of "$name")"
  [ -n "$v" ] && target_versions[$v]="$name"
done < <(git ls-tree --name-only "$TARGET_REF" "$MIGRATION_DIR/" | xargs -r -n1 basename)

conflicts=""
for v in "${!seen_in_branch[@]}"; do
  mine="$(basename "${seen_in_branch[$v]}")"
  theirs="${target_versions[$v]:-}"
  # 같은 번호인데 파일명이 다르면 병합 시 두 개가 공존한다 — 그게 사고다.
  # 파일명이 같으면 같은 마이그레이션이므로 정상이다.
  if [ -n "$theirs" ] && [ "$theirs" != "$mine" ]; then
    conflicts+="  V$v: 내 브랜치 '$mine'  ↔  $TARGET_REF '$theirs'"$'\n'
  fi
done

if [ -n "$conflicts" ]; then
  fail $'대상 브랜치에 이미 있는 버전을 다시 쓰고 있습니다. 병합되면 Flyway가 기동을 거부합니다.\n'"$conflicts"$'\n이미 적용된 쪽은 두고, 내 마이그레이션만 비어 있는 다음 번호로 올리세요.'
fi

echo "✅ Flyway 버전 검사 통과 (브랜치 내 중복 없음, $TARGET_REF 와 충돌 없음)."
