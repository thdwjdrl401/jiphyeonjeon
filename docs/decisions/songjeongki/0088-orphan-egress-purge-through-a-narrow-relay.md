# ADR-0088: 유령 Egress는 좁은 중계로 걷어낸다 — Redis를 브리지에 열지 않는다

> 📍 하네스 개요: [../../harness/README.md](../../harness/README.md) · 아키텍처: [../../ARCHITECTURE.md](../../ARCHITECTURE.md) · 계약: [../../CONTRACT.md](../../CONTRACT.md)

- **상태**: 채택
- **일자**: 2026-08-06
- **관련**: [0082](0082-ci-tests-off-the-burstable-instance.md)(유령이 처음 관측된 사건), [0034](0034-egress-completion-webhook.md)(Egress 완료 웹훅),
  [0086](0086-resource-ceilings-we-choose.md)(자원 상한을 고르는 기준), `infra/livekit/egress-purger/`
- **오너 경계**: 인프라(송정기) — 중계·ufw·시크릿 / BE — 확인·호출 / FE — 버튼

## 맥락

Egress 작업은 그것을 시작한 핸들러 **프로세스**가 소유한다. 녹화 도중 egress 컨테이너가 재시작되면
그 프로세스가 완료 보고 없이 사라지고, LiveKit은 작업을 계속 진행 중으로 들고 있다. `StopEgress`는
소유 핸들러에게 보내는 RPC라 받아 줄 상대가 없다.

```
WARN  psrpc.EgressHandler.StopEgress  "error": "no response from servers"
INFO  API Egress.StopEgress  status 408  "request timed out"
```

2026-08-05에 두 호스트에서 각각 한 건씩 생겼다. 한 건은 디버그 로그를 켜려고 lazy의 egress를
재기동하다 만든 것이고, 다른 한 건은 EC2 egress가 재시작되며 생겼다. **LiveKit에 고아를 회수하는
API가 없어서** 운영 콘솔의 정지 버튼으로도 영영 걷히지 않았고, 결국 LiveKit Redis에서 손으로 지웠다.

콘솔에서 걷어내려면 백엔드가 그 Redis에 닿아야 하는데, 닿지 않는다. 실측이다.

```
LiveKit redis    --bind 127.0.0.1 + network_mode: host   EC2 로컬에서만
백엔드 컨테이너   liveclass_default (브리지)              172.17.0.1:6379 · 172.18.0.1:6379 모두 차단
requirepass      비어 있음                                인증 없음
```

## 결정

**Redis는 지금처럼 비공개로 두고, "유령 하나 제거"라는 동사 하나만 인증해 내보낸다.**
호스트 네트워크로 뜨는 작은 중계(`infra/livekit/egress-purger`)를 두고 백엔드가 공유 시크릿으로 부른다.

```
콘솔 [유령 N건 제거]
  → 백엔드   StopEgress로 유령 확인 (아니면 중단, purged:false)
  → 중계     172.18.0.1:9107 · X-Purge-Secret
  → 중계도   StopEgress로 한 번 더 확인
  → HDEL egress <id> + 방 인덱스 SREM/DEL
```

**확인을 두 곳에서 한다.** 살아 있는 녹화의 기록을 지우면 그 녹화는 완료 보고할 곳을 잃는다.
위험한 조작의 판단은 그 조작을 실제로 하는 쪽에도 둔다 — 백엔드가 버그를 갖거나 호출이 조작돼도
중계에서 막힌다. 중계는 `EG_[A-Za-z0-9]{1,32}` 형식만 받아 임의 문자열이 Redis 키로 가지 않게 한다.

## 대안과 기각 이유

**Redis를 브리지에 노출한다**(`--bind`에 172.18.0.1 추가) — 가장 간단하다. 기각한 이유는 그 Redis에
**인증이 없다**는 것이다. 같은 브리지에는 ai-api·ai-worker·frontend가 함께 있고, 그중 하나가
뚫리면 LiveKit 제어 평면 전체를 쓰게 된다 — 남의 방을 녹화하거나 작업을 넣을 수 있는 자리다.
버튼 하나를 얻자고 치를 값이 아니다.

**`requirepass`를 걸고 브리지에 노출한다** — 위의 위험은 사라지지만, 비밀번호를 livekit.yaml ·
EC2 egress.yaml · **lazy egress.yaml**(SSH 터널로 붙는다) · 백엔드 넷에 배포하고 미디어 스택을
재기동해야 한다. 재기동은 진행 중 라이브를 끊는다(`deploy-livekit`이 `when: manual`인 이유다).
보안은 낫지만 **실패 반경이 크다** — 배포를 하나라도 틀리면 강의가 멈춘다.

**운영 스크립트만 두고 콘솔은 명령을 안내한다**(`scripts/purge-orphan-egress.sh`) — 처음에 택했다가
되돌렸다. 위험이 0이지만 운영자가 콘솔에서 한 일을 끝내지 못한다. 스크립트는 중계가 없는 환경과
중계 자체가 고장 났을 때를 위해 **남겨 둔다**.

**LiveKit의 API로 지운다** — 없다. `ListEgress`·`StopEgress`뿐이고 고아를 회수하는 것은 없다.

## 결과

중계를 추가해도 `livekit`·`egress`·`redis`는 재기동되지 않는다(compose가 바뀐 것만 올린다).
그래서 진행 중 라이브를 끊지 않고 배포할 수 있다 — 기각한 대안과 갈린 결정적 차이다.

배포에 필요한 것은 셋이다.

1. `/etc/liveclass/livekit/purger.env`의 `EGRESS_PURGE_SECRET` — 같은 값을 `/etc/liveclass/.env.prod`에도
2. `sudo ufw allow from 172.18.0.0/16 to any port 9107 proto tcp comment 'egress-purger'`
   (ufw가 브리지→호스트를 막는다. 이 규칙이 없으면 백엔드가 중계에 닿지 못한다 — 실측으로 확인했다.)
3. `docker compose -f infra/livekit/docker-compose.yml up -d egress-purger`

중계·시크릿이 없는 배포(로컬·dev)에서는 기능이 꺼지고 콘솔이 그렇게 말한다. 조용히 실패하지 않는다.

## 남는 위험

- **성공 경로를 실동작으로 보지 못했다.** 거부 경로(시크릿 없음·형식 오류·기록 없음·유령 아님)는
  운영에서 전부 실측했지만, 실제로 지우는 `deadline_exceeded` 분기는 유령이 0건이라 못 돌려봤다.
  다음에 유령이 생길 때가 첫 실전이다.
- **근본 원인은 그대로다.** 녹화 도중 egress 컨테이너가 재시작되면 유령은 또 생긴다. 회수는
  사후 처리이고, 예방은 `stop_grace_period`(현재 없음 — 기본 10초 뒤 SIGKILL)와 재시작 전
  진행 중 녹화 확인이다. 별도로 다룬다.
- **중계가 하나 더 도는 것**은 그 자체로 유지 대상이다. 다만 죽어도 녹화·라이브에는 영향이 없고
  콘솔의 회수 버튼만 실패한다 — 실패 반경을 좁게 두려고 고른 구조다.
