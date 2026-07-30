# realtime-agent 운영 scripts

## 역할

GPU 호스트 또는 개발자 PC에서 realtime-agent가 EC2의 LiveKit, dev/prod application Redis, TURN에
접근하도록 SSH port forwarding을 준비한다. agent나 원격 서비스 자체는 시작하지 않는다. 운영 GPU의
PEM 설치와 realtime-agent/BGE 공용 설정은
[`configure-gpu-ec2-tunnels.sh`](../deploy/configure-gpu-ec2-tunnels.sh)가 담당한다.

## 통신 구조

`start_ec2_tunnels.sh`는 같은 `SSH_TARGET`의 EC2 22번에 두 독립 SSH TCP connection을 만든다.
`SSH_CONTROL_PATH`는 LiveKit·두 Redis·두 health를, `TURN_SSH_CONTROL_PATH`는 TURN/TCP만 맡는다.

| connection | SSH 방향 | GPU/개발 PC | EC2 | 소비자 |
|---|---|---|---|---|
| control | local `-L` | `127.0.0.1:7443` | `localhost:7443` | prod/dev LiveKit Worker WSS/API |
| control | local `-L` | `127.0.0.1:4000` | `localhost:4000` | dev Redis lease/caption |
| control | local `-L` | `127.0.0.1:6390` | `localhost:6390` | prod Redis lease/caption |
| TURN | local `-L` | `127.0.0.1:3478` | `localhost:3478` | prod/dev TURN/TCP relay |
| control | reverse `-R` | prod `127.0.0.1:8081` | `127.0.0.1:18081` | prod health |
| control | reverse `-R` | dev `127.0.0.1:8082` | `127.0.0.1:18082` | dev health |

기존 control master에 한쪽 Redis forward만 있으면 누락 listener를 `ssh -O forward`로 동적 추가한다.
connection이 없으면 처음부터 모든 forward를 묶어 생성한다. 모든 listener는 loopback이며 GPU inbound나
EC2 application port를 새로 공개하지 않는다.

이 표의 Redis `4000`은 범용 helper의 로컬/개발 기본값이다. 운영 GPU bootstrap은 EC2 loopback에
publish된 production application Redis에 맞춰 양쪽 포트를 `6390`으로 명시해 환경파일을 생성한다.
운영 agent의 `REDIS_URL`도 `redis://127.0.0.1:6390/0`을 사용한다.

## 사용법

직접 실행은 장애 분석 또는 로컬 개발용이다. 운영 GPU 최초 설정은 deploy bootstrap을 사용한다.
필수 도구는 `ssh`, `nc`이며 PEM private key는 읽기 가능한 로컬 파일이어야 한다.

```sh
SSH_KEY=/path/to/private-key.pem \
SSH_TARGET=user@example-host \
./scripts/start_ec2_tunnels.sh
```

port override는 `LIVEKIT_*`, `DEV_REDIS_*`, `PROD_REDIS_*`, `TURN_*`, `PROD_HEALTH_*`,
`DEV_HEALTH_*` 환경변수를 사용한다. 두 Redis local port, 두 health local/remote port, control/Turn
ControlPath는 각각 달라야 한다. 레거시 단일 connection이 TURN listener를 소유하면 script가 해당
`-L`만 취소한 뒤 전용 TURN connection으로 이관한다.

script는 SSH의 `ExitOnForwardFailure`, `StrictHostKeyChecking`, `IdentitiesOnly`를 사용한다. reverse
listener는 EC2 `127.0.0.1`만 허용하며 key·token·API secret은 출력하지 않는다. 배포 supervisor는
[`../deploy/README.md`](../deploy/README.md), 전체 점검은
[`../../../docs/ai/GPU-REALTIME-AGENT-RUNBOOK.md`](../../../docs/ai/GPU-REALTIME-AGENT-RUNBOOK.md)를 따른다.

## 검증

`tests/test_operational_scripts.py`가 기존 control master에 누락된 prod Redis forward를 추가하는 경로,
dev/prod port 분리, TURN connection 이관, 외부 점유 port fail-closed와 secret 비출력 조건을 검증한다.
