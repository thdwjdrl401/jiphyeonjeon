# ADR-0033: realtime-agent 제어 트래픽과 TURN 미디어를 별도 SSH connection으로 격리

- **상태**: 채택
- **일자**: 2026-07-29
- **관련**: [ADR-0024](0024-realtime-agent-gpu-turn-runtime.md),
  [ADR-0030](0030-cross-host-realtime-agent-deployment.md),
  [GPU realtime-agent runbook](../../ai/GPU-REALTIME-AGENT-RUNBOOK.md)

## 맥락

GPU inbound가 닫혀 있어 realtime-agent는 GPU에서 EC2 22번으로 SSH local/reverse forwarding을 만든다.
기존 구현은 LiveKit signaling/API, application Redis, TURN/TCP media, agent health를 하나의 SSH control
master에 함께 실었다. 외부에서 보이는 목적지 포트가 하나라고 해서 처리 용량이 EC2 22번 포트 하나로
고정되는 것은 아니지만, 하나의 SSH TCP connection을 공유하면 지속적인 TURN 오디오 트래픽의 TCP
혼잡·재전송과 connection 재수립이 signaling·Redis·health에도 같은 장애 범위를 만든다.

BGE runtime reverse tunnel은 이미 별도 supervisor와 SSH connection을 사용한다. 같은 원칙을
realtime-agent의 제어 트래픽과 미디어 트래픽 사이에도 적용할 필요가 있다.

## 결정

동일한 PEM과 `SSH_TARGET`을 사용하되 GPU에서 EC2 22번으로 다음 세 SSH TCP connection을 유지한다.

| connection | ControlPath | forward |
|---|---|---|
| realtime control | `SSH_CONTROL_PATH` | LiveKit `-L 7443`, application Redis `-L 4000`, health `-R 18081:8081` |
| realtime TURN | `TURN_SSH_CONTROL_PATH` | coturn TCP `-L 3478` |
| BGE | BGE supervisor 전용 path | embedding runtime `-R 18020:8020` |

realtime-agent tunnel supervisor는 control과 TURN connection을 한 주기로 감시하지만 각각 별도의
OpenSSH master와 ControlPath로 생성한다. 한 connection이 정상인 동안 다른 connection만 재생성할 수
있다. 두 ControlPath가 같으면 시작을 거부한다.

배포 중 레거시 control master가 이미 TURN `-L 3478`을 소유한 경우, 해당 master에 OpenSSH
`-O cancel -L`을 보내 TURN listener만 제거하고 별도 TURN master를 시작한다. 포트가 레거시 master나
새 TURN master가 아닌 다른 process에 점유되면 소유권을 추측하지 않고 실패한다.

모든 연결은 GPU outbound에서 기존 EC2 22번으로 나가며 GPU inbound와 EC2 방화벽 포트를 추가하지
않는다. EC2 reverse listener 18020·18081도 loopback bind를 유지한다.

## 대안

| 대안 | 판단 |
|---|---|
| 모든 forward를 한 SSH master에 유지 | 단순하지만 TURN 혼잡과 재연결 장애 범위를 제어 트래픽과 공유해 기각 |
| 서비스별 EC2 공개 포트를 새로 개방 | GPU inbound 제약과 최소 공개 원칙에 어긋나 기각 |
| TURN/UDP를 SSH로 전달 | 표준 SSH forwarding이 UDP를 전달하지 않아 불가능 |
| control·TURN·BGE를 세 SSH TCP connection으로 분리 | 기존 22번과 key를 재사용하면서 장애 범위를 나눌 수 있어 채택 |

## 영향과 테스트 판단

- EC2는 같은 sshd listener에서 세 세션을 받으므로 새로운 방화벽 규칙이나 nginx 경로가 필요 없다.
- TURN은 여전히 TCP-over-TCP이므로 최종적으로 직접 TURN/TLS 또는 전용 네트워크가 가능해지면 다시
  평가한다. 이번 결정은 현재 inbound 제약 안에서 failure domain을 줄이는 조치다.
- shell 회귀 테스트는 서로 다른 ControlPath, 레거시 `-L 3478` 이관, 외부 점유 포트 fail-closed를
  검증한다.
- 실제 운영 검증은 두 realtime control master의 `ssh -O check`, GPU의 7443·4000·3478 listener,
  EC2의 18020·18081 reverse listener와 LiveKit/Redis/BGE 왕복으로 수행한다.
- API JSON 필드, 상태코드, Redis entry, dispatch metadata를 바꾸지 않으므로 공유 계약 테스트는
  불필요하다.
