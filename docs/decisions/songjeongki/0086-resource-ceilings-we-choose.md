# ADR-0086: 자원 상한을 우리가 정한다 — nginx·Hikari·Redis·consumer 이름

> 📍 하네스 개요: [../../harness/README.md](../../harness/README.md) · 아키텍처: [../../ARCHITECTURE.md](../../ARCHITECTURE.md) · 계약: [../../CONTRACT.md](../../CONTRACT.md)

- **상태**: 채택
- **일자**: 2026-08-05
- **관련**: [0078](0078-livekit-ports-off-the-blocked-range.md)(LiveKit 시그널링을 443 `/livekit`으로 — 이 때문에 미디어 시그널링도 앱 nginx를 탄다),
  [0009](0009-java21-spring-boot-3.md)(Java 21 가상 스레드 — Hikari 항목의 전제),
  [0043](0043-caption-consumer-persistence.md)(자막 Redis Stream consumer),
  [0073](0073-notification-fanout-architecture.md)(알림 팬아웃 — 폴링 정리는 별도 MR)
- **오너 경계**: BE·인프라(송정기) / FE — 없음(nginx 이미지 빌드만 프론트 Dockerfile을 스친다)

## 맥락

알림 배지가 60초 폴링과 STOMP를 함께 쓰고 있다는 것을 발견하고, "기능 구현을 우선하다 리소스를
생각하지 못한 곳이 또 있는가"를 전수 검토했다.

결과에 공통점이 있었다. **기능 코드에는 상한이 잘 걸려 있다** — Redis Stream은 `MAXLEN 10,000`으로
잘리고, 알림 팬아웃은 커서로 조각을 나누고, 재시도에는 횟수 상한이 있고, 자산 리퍼가 돈다.
그런데 **그 기능이 쓰는 자원에는 아무 상한도 없다.** nginx·Hikari·Redis·docker 로그·빌드 캐시가
전부 기본값이고, 그 기본값이 무엇인지 아무도 적어 두지 않았다.

기능 단위로 리뷰하면 보이지 않는 층이다. 어느 MR도 "nginx worker_connections"를 건드리지 않았기
때문에 아무도 그것을 본 적이 없다.

## 결정

**근거가 부하 측정에 기대지 않는 항목만** 이번에 정한다. 지금 운영 데이터는 테스트 트래픽이 섞여
있어 워크로드 근거로 쓸 수 없다. 아래 넷은 설정값·산술·공식·코드 구조에서 나오므로 측정이 필요 없다.

### ① nginx — fd와 워커 연결 수를 올린다

프록시가 백엔드보다 먼저 막히고 있었다. 실측:

| 프로세스 | nofile soft |
|---|---|
| backend JVM | 524,288 |
| **frontend nginx** (master + worker 4) | **1,024** |

`worker_connections`도 스톡 기본값 1024다. 그리고 이 둘은 **main·events 컨텍스트** 지시어라
우리가 가진 `frontend/nginx/default.conf`(http 안에 include)로는 손댈 수 없다.

상한 계산:

```
프록시된 WebSocket 1개 = nginx fd 2개 (브라우저 쪽 + 백엔드 쪽)
라이브 수강 탭 1개 = 앱 STOMP 5(알림·채팅·세션상태·자막·강의노트) + LiveKit 시그널링 1
                  = 6소켓 = fd 12
워커당 ~1024fd ÷ 12 ≈ 85명 → 4워커 ≈ 340명
(HTTP·HLS 세그먼트·MinIO 프록시가 같은 풀을 쓰므로 실제로는 더 낮다)
```

LiveKit 시그널링이 여기 끼는 것은 ADR-0078의 결과다. 그전에는 미디어 스택 자체 nginx(7443)를 탔다.

**`frontend/nginx/nginx.conf`를 새로 두고** `worker_rlimit_nofile 65535`, `worker_connections 8192`로
올린다. 나머지는 nginx:alpine 스톡 그대로 둔다.

compose `ulimits`는 넣지 않는다 — 컨테이너 하드 상한이 이미 524,288이고 마스터가 root로 떠서
`worker_rlimit_nofile`이 소프트를 하드까지 올릴 수 있다. 빌드한 이미지에서 워커의 소프트 상한이
1024 → 65535로 바뀌는 것을 확인했다.

**대가**: 메인 설정을 소유하면 베이스 이미지의 main 컨텍스트 기본값 변경을 더 이상 물려받지 않는다.
그래서 나머지 줄은 스톡과 동일하게 두고, 이미지를 올릴 때 diff를 한 번 보는 것으로 관리한다
(`docker run --rm nginx:alpine cat /etc/nginx/nginx.conf`). 파일에도 그렇게 적었다.

### ② Hikari — 풀은 그대로, 대기 시간을 줄인다

`spring.threads.virtual.enabled: true`(ADR-0009)라 요청 유입에 상한이 없는데, 뒤의 DB 풀은
기본값 10, `connectionTimeout`은 기본 30초다.

**풀 크기는 10을 유지한다.** HikariCP 권장 공식은 `connections ≈ (코어 × 2) + 스핀들`이다.
PG가 백엔드와 같은 박스(4 vCPU, SSD)에 있으므로

```
(4 × 2) + 1 = 9
```

즉 **기본값 10이 마침 이 공식의 값**이다. 4코어 PG에 20~30을 주면 컨텍스트 스위칭과 락 경합으로
오히려 느려진다. `pg max_connections`는 100이고 실측 총 커넥션은 20(liveclass 12 / ai_runtime 4 /
기타 4)이라, 여유가 없어서 막히는 상황이 아니다.

**바꾸는 것은 타임아웃이다.** 가상 스레드가 유입 상한을 없앴으므로(플랫폼 스레드 200개 제한이
암묵적 스로틀이었다) 버스트가 오면 요청이 전부 풀 앞에 줄을 선다. 30초면 그동안 매달리고,
nginx `proxy_read_timeout`이 3600s라 사용자는 그 30초를 그대로 기다린 뒤 실패를 본다.
**5초로 줄인다** — 빨리 실패하고 클라이언트가 다시 시도하는 편이 낫다.

풀 크기는 값이 안 바뀌지만 **명시한다.** 위의 가상 스레드와 짝이 되는 값이라, 어디에도 적혀 있지
않으면 "정한 적 없는 값"이 된다. 공식과 계산을 주석으로 함께 남긴다.

`application-remote.yml`의 기존 Hikari 블록(keepalive·max-lifetime)은 건드리지 않는다 —
노트북→EC2 전용이고, prod는 프로필이 비어 있어 그 파일을 읽지 않는다(`PROFILES=` 실측 확인).

**고갈 흔적은 0건이다**(`"Connection is not available, request timed out"`). 지금 터진 문제를
고치는 것이 아니라, 터질 때의 모양을 정하는 것이다.

### ③ Redis — 폭주 감지선을 긋고, eviction은 켜지 않는다

`maxmemory 0` + `noeviction`이라 상한이 없다. 같은 인스턴스에 **HTTP 세션이 함께 산다.**

`--maxmemory 1gb`를 건다. **이 값은 튜닝값이 아니라 폭주 감지선이다.** 실측 사용량이 5.69MB이고
스트림은 생산자 쪽에서 `MAXLEN 10,000`(approximate)으로 이미 잘려 있다 — 1GB에 닿는다는 것은
정상 동작이 아니라 고장이다. 조용히 부풀어 호스트를 잡아먹는 대신 시끄럽게 실패하게 둔다.

**eviction은 켜지 않는다.** `allkeys-lru`는 물론이고 `volatile-lru`도 세션에 TTL이 있어 지워
간다 — **무작위 로그아웃**이 된다. 인스턴스당 정책은 하나뿐이므로 캐시와 세션을 같이 두면 한쪽을
포기해야 하고, 지금은 캐시 용도 키가 사실상 없으므로 세션 쪽으로 몰아 두는 것이 맞다.

**인스턴스 분리는 지금 하지 않는다.** 분리의 본래 이유가 바로 위의 정책 충돌인데, 지금은 충돌이
없다. AOF도 켜져 있어(`appendonly yes`) 세션이 재시작을 견딘다.

> ⚠️ **DB 인덱스 분리(`SELECT 0/1`)는 격리가 아니다.** 같은 프로세스, 같은 메모리, **같은
> maxmemory, 같은 정책**이다. 자주 오해하는 부분이라 적어 둔다. 나누려면 인스턴스를 나눠야 한다.

**분리 트리거** — 다음 중 하나가 생기면 세션용 인스턴스를 뗀다.
- 캐시 용도(버려도 되는) 키가 생겨 `allkeys-lru`가 필요해질 때
- AI 스트림의 `MAXLEN` 캡이 풀리거나, 캡 없는 키가 늘어 사용량이 100MB를 넘길 때

### ④ Redis Stream consumer 이름을 고정한다

`CaptionStreamProperties.defaultConsumerName()`이 `"spring-" + $HOSTNAME`을 쓰는데, **도커에서
HOSTNAME은 컨테이너 ID**라 배포마다 바뀐다. 주석에 적힌 의도("안정적이어야 재기동 시 자기
pending을 이어받는다")가 실현되지 않고 유령만 쌓인다 — 실측 **193개**(배포 횟수만큼),
가장 오래된 것의 idle이 50시간이었다.

지금은 `pending`이 전부 0이라 메시지 유실은 없다. 그러나 **pending이 남은 채로 이름이 바뀌면 그
엔트리는 아무도 이어받지 못한다** — 이름이 안정적이어야 하는 이유가 바로 그것이고, 그게 지금
깨져 있다.

compose에 `CAPTION_CONSUMER_NAME: spring-prod-1`,
`LECTURE_NOTE_CONSUMER_NAME: spring-notes-prod-1`을 준다. `LectureNoteStreamProperties`도 같은
패턴을 갖고 있어 함께 고정한다.

> 이름은 `application.yml`의 플레이스홀더를 그대로 쓴다(`consumer: ${CAPTION_CONSUMER_NAME:}`).
> 완화 바인딩(`LIVECLASS_CAPTION_CONSUMER`)은 이 프로젝트 규약이 아니라 **조용히 무시된다** —
> 처음에 그렇게 썼다가 잡았다.

백엔드는 단일 인스턴스라 고정값 하나로 충분하다. 여러 개로 늘리면 인스턴스마다 다른 값을 줘야 한다.

## 이번에 정하지 않은 것

**컨테이너 메모리 제한.** `mem_limit`의 가치는 평상시 절약이 아니라 **"고장 났을 때 피해를 그
컨테이너에 가둔다"**이고, 그 논거는 측정 없이도 성립한다. 문제는 **숫자**다.

cgroup 고수위를 읽어 보긴 했다.

| 컨테이너 | 피크 | 관측 창 |
|---|---|---|
| minio | 1,624 MB | 1.3일 |
| backend | 881 MB | **1시간(배포 직후)** |
| rabbitmq | 251 MB | 1.3일 |
| 나머지 6개 | 10~139 MB | |

그런데 지금 운영 트래픽은 테스트가 섞여 있어 워크로드 근거가 되지 못한다. 특히 backend는 관측 창
1시간에 라이브 강의가 없었다. **측정 없이 값을 걸면 지금 없는 문제(강의 중 OOM)를 만든다.**
OOM 이력은 0건이고 피크 합계가 3.4GB / 15.6GB라 급하지도 않다.

실제 사용이 생긴 뒤 `memory.peak`으로 다시 잡는다. 읽는 법:

```bash
id=$(docker inspect -f '{{.Id}}' liveclass-backend-prod)
sudo find /sys/fs/cgroup -maxdepth 4 -path "*$id*" -name memory.peak -exec cat {} \;
```

**STOMP 소켓 통합(5→1).** 라이브 탭이 `new Client`를 5번 만든다(알림·채팅·세션상태·자막·강의노트).
합치면 탭당 fd가 12 → 4로 준다. 다만 ①로 상한이 크게 오르면 급하지 않고, 라이브 화면 전체를
건드려 회귀 위험이 크다. 브로커가 단일 인스턴스 `enableSimpleBroker`라 다중 인스턴스 확장 때
어차피 다시 봐야 하므로 그때 함께 다룬다.

**알림 폴링 제거.** 같은 검토에서 나왔지만 FE 변경이라 별도 MR로 뗀다.

## 검증

| 확인 | 방법 |
|---|---|
| nginx 메인 설정이 파싱된다 | 빌드한 이미지에서 `nginx -t` (conf.d 제외) — 통과 확인 |
| 워커 fd 소프트 상한이 오른다 | 컨테이너 안 `/proc/<worker>/limits` — **1024 → 65535** 확인 |
| compose가 유효하다 | `docker compose config` — redis command·consumer 이름 렌더 확인 |
| Hikari 값이 적용된다 | 기동 로그 `HikariPool-1`, `pg_stat_activity` 커넥션 수 |
| Redis 상한이 걸린다 | `redis-cli config get maxmemory maxmemory-policy` → `1073741824` / `noeviction` |
| 세션이 재생성을 견딘다 | redis 컨테이너 교체 후 로그인 유지 확인(AOF + `redisdata` 볼륨) |
| consumer 이름이 배포에 안 바뀐다 | 두 번 배포 후 `xinfo groups ai:captions:live`가 같은 이름인지 |
