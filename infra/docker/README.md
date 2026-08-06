# 도커 데몬 설정 — 빌드 캐시 GC · 로그 로테이션 · live-restore

> 관련: [ADR-0086](../../docs/decisions/songjeongki/0086-resource-ceilings-we-choose.md) 
>
> **이 디렉터리의 파일은 레포에서 서버로 자동 배포되지 않는다.** `/etc/docker/daemon.json`은 도커
> 데몬이 읽는 서버 파일이라 compose·CI가 건드릴 수 없다. 여기 있는 것은 **정본 사본**이고,
> 적용은 아래 절차로 사람이 한다.

## 왜 필요한가

EC2에는 `/etc/docker/daemon.json`이 **없었다.** 즉 빌드 캐시 GC와 로그 로테이션이 전부 도커
기본값에 맡겨져 있었고, 그 기본값이 무엇인지 우리가 모른다.

실측(2026-08-05):

```
빌드 캐시   110.1 GB   (디스크 309G 중 144G 사용 = 47%)
나이 분포   0–1일 23.6GB · 1–7일 74.1GB · 7–14일 12.4GB · 14일 이상 0
docker root 생성  20일 전
컨테이너 로그 설정  json-file, log-opts 없음  → 로테이션 없음
Live Restore Enabled  false
```

14일 넘은 캐시가 없으므로 **GC는 이미 돌고 있다** — 무한 증가가 아니라 약 110GB에서 정체다.
문제는 **그 상한을 우리가 정하지 않았다**는 것이다. 기본 정책이 나이 기준인지 여유 공간 기준인지
알 수 없고, 여유 공간 기준이라면 디스크가 찰 때까지 쓰다가 정리하므로 Postgres·MinIO와 마지막
공간을 놓고 경쟁한다.

캐시가 커지는 원인은 백엔드 이미지 빌드다 — `./gradlew clean bootJar` 실행 마운트가 138건 × 337MB,
jar COPY 레이어가 140건 × 213MB. (같은 파일의 프론트 `npm ci`는 9건뿐이다. 의존성 레이어 캐시가
프론트에서는 동작하고 백엔드에서는 동작하지 않기 때문인데, 그건 이 문서 범위 밖이다.)

## daemon.json

```json
{
  "builder": {
    "gc": {
      "enabled": true,
      "policy": [
        { "keepStorage": "20GB", "filter": ["unused-for=168h"] },
        { "keepStorage": "40GB", "all": true }
      ]
    }
  },
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "50m",
    "max-file": "5"
  },
  "live-restore": true
}
```

- **`builder.gc`** — 상한을 40GB로 명시한다. 지금 110GB에서 정체하고 있으므로 첫 적용 시 약 70GB가
  회수된다. 7일 넘게 안 쓴 캐시는 20GB까지만 남긴다. 값을 낮추면 CI 빌드가 캐시를 덜 맞아 느려지므로,
  파이프라인 시간이 눈에 띄게 늘면 이 값부터 본다.
- **`log-opts`** — 컨테이너당 최대 250MB(50m × 5). 지금은 로테이션이 아예 없다.
- **`live-restore`** — 데몬을 재시작해도 컨테이너를 죽이지 않는다. **이번 적용 자체는 이 옵션이
  없는 상태에서 시작하므로 중단을 피할 수 없다**(아래). 다음번부터 무중단이 된다.

## 적용 절차

> ⚠️ **전면 중단 약 1분.** `Live Restore Enabled: false`인 상태에서 `systemctl restart docker`를
> 하면 모든 컨테이너가 재시작된다. 전부 `restart: unless-stopped`라 자동 복구되지만,
> **라이브 강의 중에는 하지 않는다.**

```bash
# 1) 진행 중인 라이브 세션이 없는지 확인
ssh ec2 'docker logs liveclass-backend-prod --since 10m 2>&1 | grep -i "live.*start" | tail'

# 2) 파일 배치 (이 디렉터리의 daemon.json을 그대로)
scp infra/docker/daemon.json ec2:/tmp/daemon.json
ssh ec2 'sudo install -o root -g root -m 0644 /tmp/daemon.json /etc/docker/daemon.json'

# 3) 문법 검증 후 재시작
ssh ec2 'sudo dockerd --validate --config-file /etc/docker/daemon.json && sudo systemctl restart docker'

# 4) 확인
ssh ec2 'docker info | grep -i "live restore"'          # → true
ssh ec2 'docker ps --format "{{.Names}}\t{{.Status}}"'   # 전부 Up
ssh ec2 'docker buildx du | tail -3'                     # 며칠 관찰하며 상한이 걸리는지
```

**`log-opts`는 새로 만들어지는 컨테이너에만 적용된다.** 기존 컨테이너는 다음 배포
(`docker compose ... up -d --build`)로 교체될 때 반영된다. 확인:

```bash
ssh ec2 'docker inspect --format="{{.HostConfig.LogConfig}}" liveclass-backend-prod'
```

## 함께 하는 일회성 정리

**유령 Redis Stream consumer.** ADR-0086 ④로 이름을 고정하기 **전에** 쌓인 것들이다. 배포로 새
이름(`spring-prod-1`)이 뜬 **뒤에** 지운다.

```bash
# pending이 0인 것만 지운다 — 실측상 전부 0이지만 매번 확인한다.
ssh ec2 'docker exec liveclass-redis-prod redis-cli --no-raw \
  xinfo consumers ai:captions:live spring-caption-live-v1' | head -40

# 새 이름을 제외하고 삭제
ssh ec2 'docker exec liveclass-redis-prod sh -c "
  redis-cli xinfo consumers ai:captions:live spring-caption-live-v1 |
  awk \"/^name\$/{getline; print}\" |
  grep -v \"^spring-prod-1\$\" |
  while read n; do redis-cli xgroup delconsumer ai:captions:live spring-caption-live-v1 \"\$n\"; done
"'
```

**고아 강의 노트 상태 키.** 정상 종료 시 지우는 코드가 있으므로(`redis_lecture_note_publisher.py`)
비정상 종료로 남은 것만 정리한다. TTL이 없어 그냥 두면 영구히 남는다.

```bash
ssh ec2 'docker exec liveclass-redis-prod redis-cli --scan --pattern "ai:lecture-notes:mvp:state:*"'
# 진행 중인 세션이 아닌 것만 골라 DEL
```
