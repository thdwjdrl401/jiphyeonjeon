#!/usr/bin/env bash
#
# 증거 캡처 공용 헬퍼.
#
# **화면에 찍는 명령을 손으로 쓰지 않는다.** 손으로 쓰면 실제 명령과 어긋난다. 실제로 그랬다.
# compose 는 -f 가 붙은 셸 함수인데 화면에는 `docker compose ...` 라고만 찍어서, 독자가
# 그대로 치면 루트 compose 파일을 읽어 recorded-stt-worker 의 OPENAI_API_KEY 를 요구하며
# 죽었다. curl 은 인증 플래그를 빼고 찍어 그대로 치면 401 이었다. 아래 함수들은 실제로 넘길
# argv 에서 문자열을 만들므로 어긋날 수 없다.
#
# **파이프를 두지 않는다.** docker 는 stdout 이 TTY 가 아니면 색·체크마크·진행 시간을 끈다.
# 들여쓰기 하나 때문에 화면이 터미널 기록이 아니라 편집기에 쳐 넣은 텍스트처럼 읽혔다.
#
# 쓰는 쪽에서 먼저 정의해야 하는 것: CF(compose 파일 상대 경로), compose(), pgv().
# 상대 경로를 찍으므로 쓰는 쪽이 저장소 루트로 cd 해 두어야 한다.

q() {  # 셸에 다시 넣어도 같은 한 낱말이 되게 감싼다
  local esc="'\\''"
  case "$1" in
    *[!A-Za-z0-9_/:.,=@%+-]*) printf "'%s'" "${1//\'/$esc}" ;;
    *) printf '%s' "$1" ;;
  esac
}

show_argv() {  # $1=명령 머리, 나머지=인자. 140칸에서 접는다
  local head="$1"; shift
  # 플래그와 그 값을 한 덩이로 묶는다. 안 묶으면 -H 만 줄 끝에 남고 값이 다음 줄로 넘어간다.
  local -a unit=(); local i=1 n=$#
  while [ $i -le $n ]; do
    local a="${!i}" b="" j=$(( i + 1 ))
    case "$a" in
      -*) if [ $j -le $n ]; then b="${!j}"; case "$b" in -*) b="" ;; *) i=$j ;; esac; fi ;;
    esac
    if [ -n "$b" ]; then unit+=("$(q "$a") $(q "$b")"); else unit+=("$(q "$a")"); fi
    i=$(( i + 1 ))
  done
  local line="\$ $head" tok
  for tok in "${unit[@]}"; do
    if [ $(( ${#line} + ${#tok} + 1 )) -gt 140 ]; then
      printf '%s \\\n' "$line"; line="    $tok"
    else
      line="$line $tok"
    fi
  done
  printf '%s\n' "$line"
}

runc() { echo; show_argv "docker compose -f $CF" "$@"; compose "$@" < /dev/null; }

# SQL 은 자리표시가 아니라 실제로 돌린 문장을 찍는다. 세는 방식이 보여야 숫자가 증거가 된다.
runq() {
  echo
  echo "\$ docker compose -f $CF exec -T -e PGPASSWORD=bench postgres \\"
  echo "    psql -U liveclass -d liveclass -c \"$1\""
  pgv -c "$1"
}
