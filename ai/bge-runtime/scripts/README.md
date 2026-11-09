# `bge-runtime/scripts`

> 현재 상태: 아래에 적힌 `smoke_cuda.py`와 `start_ec2_reverse_tunnel.sh`, `deploy/` 디렉토리는 삭제됐다(커밋 `c490634b`). 이 디렉토리에는 이 README만 남아 있고, 운영은 저장소 루트의 `docker-compose.bge-cpu.yml`을 쓴다.

실제 CUDA와 pinned BGE-M3 model을 확인하는 수동 smoke 도구다.

## 역할

- model cache·CUDA device·revision을 확인한다.
- local BGE readiness를 확인한 뒤 EC2 loopback reverse SSH tunnel을 foreground로 유지한다.
- 차원·finite·unit norm·순서와 cold/warm latency, GPU memory를 측정한다.

## 구조와 흐름

`smoke_cuda.py --offline`은 cache가 없으면 다운로드하지 않고 실패한다.

## 파일 구성

`smoke_cuda.py`는 GPU 검증 entrypoint이고, `start_ec2_reverse_tunnel.sh`는 GPU BGE를 EC2
loopback endpoint로 연결하는 운영 entrypoint다.

## 경계와 불변식

- 입력 원문과 embedding vector를 출력하지 않는다.
- reverse tunnel은 `127.0.0.1` 양 끝만 연결하며 BGE port를 public bind하지 않는다.
- SSH host key를 사전 등록하고 tunnel 전용 key·계정을 사용한다.
- 단일 smoke 결과를 STT 동시 실행 용량 증거로 사용하지 않는다.

## EC2 reverse tunnel

먼저 `bge-runtime`을 `127.0.0.1:8020`에서 warmup한다. 그 다음 GPU 서버에서 아래 script를 foreground로
실행한다. EC2의 tunnel 전용 SSH 계정은 아래와 동등하게 remote forwarding만 허용하고 listener를
loopback으로 제한한다.

```text
Match User bge-tunnel
    AllowTcpForwarding remote
    GatewayPorts no
    PermitListen 127.0.0.1:18020
    AllowAgentForwarding no
    X11Forwarding no
    PermitTTY no
    MaxSessions 0
```

공개키도 `restrict,port-forwarding,permitlisten="127.0.0.1:18020"` 옵션으로 제한한다. EC2 security group에는
18020을 열지 않는다. script는 `-F /dev/null`을 사용하므로 `SSH_TARGET`은 직접 해석 가능한 host여야 하고, EC2
host key는 실행 계정의 기본 `known_hosts`에 미리 등록한다.

```bash
SSH_KEY=/secure/path/bge-tunnel.pem \
SSH_TARGET=bge-tunnel@ec2.example.internal \
BGE_LOCAL_PORT=8020 \
BGE_EC2_PORT=18020 \
./scripts/start_ec2_reverse_tunnel.sh
```

EC2에서는 `curl http://127.0.0.1:18020/readyz`를 확인하고 host process ai-worker에
`AI_WORKER_BGE_RUNTIME_URL=http://127.0.0.1:18020`을 주입한다. script는 local BGE가 ready가 아니거나 SSH
forward 생성에 실패하면 즉시 종료하므로 supervisor가 재기동을 맡는다 — GPU host에는 sudo/systemd가
없어 실제 감독자는 tmux 기반 `deploy/bin/liveclass-bge-runtime-supervisor`(삭제됨)다.
[ADR-0029](../../../docs/decisions/canola/0029-gpu-bge-ec2-ai-worker-connectivity.md)가 통신 방식과 대안을 기록한다.

## 검증

`uv run --frozen --extra cuda python scripts/smoke_cuda.py --offline`
