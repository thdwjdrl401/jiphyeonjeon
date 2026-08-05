# 테스트 전용 GitLab 러너

> 관련: [`.gitlab-ci.yml`](../../../.gitlab-ci.yml) · [원격 Egress](../../livekit/remote-egress/README.md)(같은 이유로 부하를 뗀 사례)

## 왜 뗐나

EC2 한 대에 **운영 스택·녹화·CI가 전부** 얹혀 있었다. 4코어다. 최근 잡 400개 실측:

```
test-backend    실행 최소 4s → p50 163s → p90 293s → 최대 1,050s   (253배 편차)
test-frontend   대기 p50 96s · p90 530s · 최대 1,349s
러너            1대 · concurrent = 1
```

편차의 정체는 **CPU를 누구와 나누느냐**다. 테스트가 도는 동안 부하가 4코어에 18까지 갔고,
그 사이 운영도 같이 느려졌다. `concurrent = 1`이라 잡은 줄을 서는데, 대기열은 러너 전역이라
MR 화면에서는 "앞에 아무것도 없는데 pending"으로 보인다.

**가장 무거운 `test-backend`만 뗀다.** Testcontainers로 Postgres·Redis까지 띄우는 잡이라
부하의 대부분이 여기다.

## 무엇을 못 옮기나

`build`·`deploy` 계열은 **shell executor로 그 호스트에서 제자리 배포**한다. 시크릿
(`/etc/liveclass/.env.prod`)도 그 서버에만 있다. 옮길 수 없고 옮길 이유도 없다 — 부하가 큰
쪽은 테스트다.

`test-frontend`는 **아직 EC2에 남긴다.** 이 호스트에서 리허설했더니 실행마다 다른 테스트가
깨졌다(같은 명령 2회에 결과가 갈렸다). 개별 테스트 문제가 아니라 스위트 전반의 비결정성이고,
[`vite.config.ts`](../../../frontend/vite.config.ts) 주석에도 스파이 누수로 순서 의존이 있다고
기록돼 있다. 그 문제를 먼저 풀고 옮긴다.

## 구성

```
lazy (8코어)
  lazy-runner-runner-1     GitLab 러너 (shell executor, concurrent 2)
    └─ docker.sock ────▶ 호스트 도커 데몬 ─▶ 잡이 띄우는 형제 컨테이너
                                              (eclipse-temurin, Testcontainers의 pg·redis·ryuk)
```

세 가지가 맞물려야 돈다.

**① 도커 CLI** — 공식 러너 이미지에 없다. 우리 잡은 전부 `docker run ...`으로 빌드 도구를
띄우므로(shell executor 호스트에 Java/Node가 있다는 보장이 없어 그렇게 짜여 있다) 필수다.
없으면 첫 잡이 `docker: command not found`로 죽는다.

**② 빌드 경로가 호스트와 같아야 한다** — 잡이 `-v "$CI_PROJECT_DIR:$CI_PROJECT_DIR"`로
워크스페이스를 형제 컨테이너에 넘기는데, 그 경로는 **호스트 데몬**이 해석한다. 러너 컨테이너
안의 경로와 호스트 경로가 다르면 빈 디렉토리가 마운트되어 "소스가 없다"로 죽는다.
그래서 `builds_dir`을 호스트와 같은 `/home/lazy/ci-builds`로 잡고 같은 경로로 마운트한다.

**③ `network_mode: host`** — Testcontainers가 게시한 포트는 호스트에 열린다. 테스트 JVM이
`localhost`로 닿으려면 필요하다.

## 셋업

**① 러너 등록** — GitLab에서 프로젝트 러너를 만들고(태그 `lazy-test`, run_untagged 끔) 토큰을 받는다.

**② 설정** — `config.template.toml`의 `<RUNNER_TOKEN>`을 채워 `config/config.toml`로 저장한다(커밋 금지).

```bash
mkdir -p ~/ci-builds config
sed "s|<RUNNER_TOKEN>|$TOKEN|" config.template.toml > config/config.toml
chmod 600 config/config.toml
```

**③ 기동**

```bash
docker compose up -d --build
```

sudo가 필요 없다. 도커가 재시작·재부팅 복구를 맡는다.

## 확인

```bash
docker compose ps                       # runner 가 Up
docker exec lazy-runner-runner-1 docker version   # CLI 가 호스트 데몬에 닿는가
```

GitLab 쪽에서 러너가 online 인지 본다. 잡을 실제로 받기 전에 **리허설**을 권한다 — 잡 스크립트를
그대로 떼어 손으로 돌려 보면 환경 차이가 먼저 드러난다. 실제로 그렇게 해서 두 가지를 잡았다:

- `vitest`의 `maxForks`만 지정해 8코어에서 **테스트가 한 건도 안 도는** 설정 버그
- `MockHttpServletResponse`를 두 스레드가 다투던 백엔드 테스트 경쟁

> 리허설할 때 **`CI=true`를 넣어야 한다.** 넣지 않으면 `.gitlab-ci.yml`이 아니라 로컬 기본값으로
> 돌아 실제 잡과 다른 조건을 재게 된다(포크 수가 달라진다).

## 되돌리기

`.gitlab-ci.yml`의 `test-backend` 태그를 `[ec2-liveclass]`로 되돌리면 끝이다. 이 호스트에서
`docker compose down` 하면 러너도 사라진다. EC2 쪽은 아무것도 바뀐 것이 없다.

## 주의

- **가정용 회선을 탄다.** 러너는 GitLab으로 아웃바운드만 하므로 포트를 열 필요는 없지만,
  회선이 끊기면 백엔드 테스트가 멈춘다. 그때는 위 태그를 되돌리면 즉시 EC2로 돌아간다.
- 이 호스트는 [원격 Egress](../../livekit/remote-egress/README.md)도 돌린다. 녹화 중에는
  코어를 나눠 쓰므로, 둘이 겹칠 때의 실측치는 아직 없다.
