# 알림 팬아웃·발송 측정

100만 명에게 알림 하나를 보내는 데 무엇이 얼마나 걸리는지 잰 기록. 그래프는
`bench/run-monitored.sh`가 돌린 실행을 Grafana에서 뜬 것이다.

## 결론

발송은 건당 암호화(ECDH + HKDF + AES-GCM + VAPID 서명) 때문에 CPU를 많이 쓴다. 공유 자원인
DB는 21%밖에 안 건드리므로 **노드를 늘린 만큼 처리량이 늘어난다** — 물리 1코어 1,483건/s,
2코어 2,654건/s로 1.79배. 그래서 발송을 별도 머신에서 돌리는 구조로 간다.

1분 예산을 팬아웃 20초 + 발송 40초로 나누면 이렇게 계산된다.

```
발송 필요 처리량   1,097,488건 ÷ 40초 = 27,437건/s
코어당             1,327건/s          (2노드 실측, 보수적으로 낮은 쪽)
                   ─────────────────
                   20.7 물리코어  →  8코어 서버 3대
```

팬아웃은 한 대로 끝난다(18.8초). 워커를 늘려도 DB가 막아 안 빨라진다.

## 이 실행의 조건

| | |
|---|---|
| 측정 대상 | 수강생 1,000,000명 · 푸시 구독 1,097,488건 |
| 하드웨어 | i7-6700HQ 4물리코어 |
| 코어 배정 | Postgres 2코어 · 앱 1코어 · 브로커 1코어 |
| 설정 | 갈래 2 · 조각 5,000명 · 팬아웃 소비자 8 |
| 결과 | 팬아웃 23.6초 · 발송 12분 |

**코어를 팬아웃과 발송으로 나눈 것이 아니다.** 앱 컨테이너 하나가 물리 1코어에서 둘을 다
돌리고, 구간은 시간으로 갈린다. 팬아웃이 도는 도중에 푸시 명령이 큐에 들어가면 발송이 곧바로
같은 코어를 쓰기 시작한다 — 그 대가가 이 수치다.

```
발송 리스너 끔    18.812초
발송 리스너 켬    23.612초   +26%
```

이 26%가 노드를 나눠야 하는 이유이고, 나눈 뒤의 값은 발송 전용 노드에 코어를 주고 따로 쟀다.

## 관측 위치

Prometheus·Grafana·렌더러는 **측정 머신 밖에서** 돌린다. 같은 머신에서 돌렸을 때 팬아웃이
18.3초에서 20.976초로 늘어(+15%) 노이즈가 수치에 남았다. 옮긴 뒤는 18.786초다.

`cAdvisor`는 cgroup과 `/var/lib/docker`를 읽어야 해서 옮길 수 없다. 그래서 관측을 완전히 끈
값(18.3초)이 대표 수치이고, 여기 그래프는 그 수치가 어떤 모양으로 흘러가는지를 보여 준다.

## 그래프

| 파일 | 무엇을 보나 |
|---|---|
| `graphs/01-container-cpu.png` | 발송(앱, 파랑)이 12분 내내 157%를 먹는다. 팬아웃 구간에도 이미 올라와 있어 Postgres 봉우리가 눌렸다 |
| `graphs/02-insert-rate.png` | 알림 행(초록)과 중복 제거 등록표(분홍 파선)가 완전히 포개진다. 알림 하나에 두 행을 쓴다 |
| `graphs/03-queue-depth.png` | 팬아웃 큐는 갈래 수만큼만 떠 있고, 푸시 큐는 21초에 200개가 쌓여 12분에 걸쳐 빠진다 |
| `graphs/04-jvm-heap.png` | 수신자가 100만 명이어도 힙은 평평하다. 조각으로 끊어 읽기 때문 |
| `graphs/05-active-backends.png` | 동시에 도는 조각 수가 물리 코어 수 근처에서 멈춘다 |
| `graphs/06-connection-pool.png` | Hikari 풀 10개를 소비자와 웹 요청이 나눠 쓴다 |

## 다시 뜨는 법

```bash
# 측정 머신: exporter만
ssh lazy 'cd ~/apps/liveclass && PHASE=both bash bench/run-monitored.sh'

# 로컬: 터널 + 관측
ssh -N -L 18081:127.0.0.1:18081 -L 15692:127.0.0.1:15692 \
       -L 19187:127.0.0.1:19187 -L 18082:127.0.0.1:18082 lazy &
docker compose -f bench/monitoring/compose.remote.yml up -d

# 스크린샷 (창은 실행이 남긴 window.json)
curl -o graphs/01-container-cpu.png \
  "http://127.0.0.1:13000/render/d-solo/fanout-bench?panelId=2&from=<ms>&to=<ms>&width=1400&height=560&theme=light"
```

## 관련 기록

- [ADR-0127](../decisions/songjeongki/0127-push-worker-node-role-split.md) 발송 워커를 별도 노드로
- [ADR-0130](../decisions/songjeongki/0130-a-wide-fanout-goes-out-in-lanes.md) 넓은 팬아웃을 갈래로
- [ADR-0131](../decisions/songjeongki/0131-the-next-slice-goes-out-before-the-app-work.md) 다음 조각을 앱 일보다 먼저
