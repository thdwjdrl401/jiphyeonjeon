# realtime-agent 운영 scripts

## 역할

GPU 호스트 또는 개발자 PC에서 realtime-agent가 EC2의 LiveKit, application Redis, TURN에 접근하도록
SSH port forwarding을 준비한다. 이 폴더의 script는 agent나 원격 서비스를 시작하지 않는다. 운영
GPU의 PEM 설치와 realtime-agent/BGE 공용 설정은
[`configure-gpu-ec2-tunnels.sh`](../deploy/configure-gpu-ec2-tunnels.sh)가 담당한다.

## 통신 구조

`start_ec2_tunnels.sh`는 같은 `SSH_TARGET`의 EC2 22번에 두 개의 독립 SSH TCP connection을 만든다.
`SSH_CONTROL_PATH` 연결은 LiveKit·Redis·health를, `TURN_SSH_CONTROL_PATH` 연결은 TURN/TCP만 맡는다.
기존 connection이 살아 있으면 해당 listener만 검증하고, 한쪽이 끊기면 그 connection만 복구한다.

| connection | SSH 방향 | GPU/개발 PC | EC2 | 소비자 |
|---|---|---|---|---|
| control | local `-L` | `127.0.0.1:7443` | `localhost:7443` | LiveKit Worker WebSocket/API |
| control | local `-L` | `127.0.0.1:4000` | `localhost:4000` | application Redis lease/caption |
| TURN | local `-L` | `127.0.0.1:3478` | `localhost:3478` | TURN/TCP relay |
| control | reverse `-R` | `127.0.0.1:8081` | `127.0.0.1:18081` | EC2 Java health check |

모든 기본 listener는 loopback이다. GPU 호스트에 inbound application port를 공개하지 않으며 OpenAI
Realtime WSS 같은 provider outbound 연결은 이 tunnel의 대상이 아니다.

## 사용법

아래 직접 실행은 장애 분석 또는 로컬 개발용이다. 운영 GPU 최초 설정은 deploy bootstrap을 사용한다.
필수 도구는 `ssh`, `nc`이며 PEM private key는 읽기 가능한 로컬 파일이어야 한다.

```sh
SSH_KEY=/path/to/private-key.pem \
SSH_TARGET=user@example-host \
./scripts/start_ec2_tunnels.sh
```

port를 바꿀 때는 `LIVEKIT_LOCAL_PORT`, `LIVEKIT_REMOTE_PORT`, `REDIS_LOCAL_PORT`,
`REDIS_REMOTE_PORT`, `TURN_LOCAL_PORT`, `TURN_REMOTE_PORT`, `HEALTH_LOCAL_PORT`,
`HEALTH_REMOTE_PORT`를 명시한다. `SSH_CONTROL_PATH`를 여러 작업이 공유하면 같은 tunnel로 인식하므로
호스트·환경별로 충돌하지 않는 경로를 사용한다. `TURN_SSH_CONTROL_PATH`는 control path와 반드시
달라야 한다. 레거시 단일 connection이 TURN listener까지 소유하고 있으면 script가 control socket의
해당 `-L`만 취소한 뒤 별도 TURN connection으로 이관한다.

script는 시작 전에 local port 점유 여부를 확인하고 SSH의 `ExitOnForwardFailure`,
`StrictHostKeyChecking`, `IdentitiesOnly`를 사용한다. reverse listener는 EC2 `127.0.0.1`만 허용한다.
key 내용, token, API secret은 출력하지 않는다. production supervisor와 환경파일 구성은
[`../deploy/README.md`](../deploy/README.md), 전체 점검 절차는
[`docs/ai/GPU-REALTIME-AGENT-RUNBOOK.md`](../../../docs/ai/GPU-REALTIME-AGENT-RUNBOOK.md)를 따른다.

## 검증

`tests/test_operational_scripts.py`가 필수 환경 변수, local/reverse forward, 서로 다른 control socket,
레거시 TURN forward 이관과 운영 script의 secret 비출력 조건을 검증한다.
