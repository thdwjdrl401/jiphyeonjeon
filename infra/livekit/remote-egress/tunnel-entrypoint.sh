#!/bin/sh
# 마운트된 키를 컨테이너 안으로 복사한 뒤 ssh를 띄운다.
#
# 그냥 마운트한 키를 -i로 주면 ssh가 "bad ownership or modes"로 거부한다 — 호스트에서
# 키 주인은 일반 사용자인데 컨테이너 안에서는 root로 돌기 때문이다. 호스트 파일의
# 소유권·권한은 건드리지 않고 사본만 root:600으로 만든다.
set -e
install -m 600 /key /tmp/id_tunnel
exec ssh -i /tmp/id_tunnel "$@"
