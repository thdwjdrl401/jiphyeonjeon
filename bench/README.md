# bench — 알림 팬아웃·발송 측정 환경

수강생 100만 명에게 알림 하나를 보낼 때 무엇이 얼마나 걸리는지 재는 스크립트 모음. 결론과 수치는
[docs/benchmark/README.md](../docs/benchmark/README.md)에 있다.

## 사용법

```bash
bench/seed/run-seed.sh     # 1. 수강생 100만 명과 구독을 시드한다
bench/run-e2e.sh           # 2. 사건 발생부터 마지막 기기 발송까지 전체 경로를 잰다
ls bench/results/          # 3. 실행마다 타임스탬프 폴더에 로그와 수치가 남는다
```

- 앱, Postgres, Redis, RabbitMQ, 목 푸시 서버, 수집기(exporter)는 [compose.bench.yml](compose.bench.yml)로 함께 뜬다.
- 목 푸시 서버([mock-push/](mock-push/))는 공급자 왕복 지연을 흉내 내고 받은 건수를 센다. 완료 판정은 이 서버가 받은 건수로 한다.
- 지연은 `MOCK_DELAY`로 넣는다(기본 50ms). 측정 문서의 대표 수치는 FCM 왕복 실측값인 `MOCK_DELAY=230ms` 기준이다.
- 관측을 켜려면 `bench/run-monitored.sh`. Prometheus와 Grafana 설정은 [monitoring/](monitoring/)에 있다.

## 스크립트

| 무엇을 재나 | 스크립트 |
|---|---|
| 순진한 구조(동기 처리) 기준선 | `run-serial.sh`, `run-naive.sh` |
| 게시와 알림 분리(Outbox) 근거 | `run-outbox-evidence.sh` |
| 일괄 조회 OOM 재현 | `oom-break.sh`, `oom-sweep.sh`, `run-memctx-evidence.sh` |
| 조각 크기, 체인 수 | `run-slice.sh`, `run-chains.sh`, `run-waits.sh`, `run-fk-contention.sh` |
| 팬아웃 한 번의 DB 작업량 | `run-dbload.sh`, `run-ablation.sh`, `run-unread-index.sh` |
| Web Push 암호화 단건 비용 | `run-crypto.sh` |
| 구간별 측정, 겹침 | `run-phases.sh`, `run-timeline.sh` |
| 워커 수에 따른 확장성 | `run-scale.sh` |
| 병목 분석 | `run-probe.sh` |
| 전체 경로 | `run-e2e.sh`, `run-monitored.sh` |

각 스크립트 첫머리 주석에 목적, 사용법, 환경 변수가 있다.
