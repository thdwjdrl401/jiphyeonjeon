# 테스트 전용 GitLab 러너

> 관련: `.gitlab-ci.yml`(저장소에서 삭제됨) · [원격 Egress](../../livekit/remote-egress/README.md)(같은 이유로 부하를 뗀 사례)
>
> 현재 상태: `.gitlab-ci.yml`은 저장소에 없다. 테스트는 GitHub 호스티드 러너(`.github/workflows/ci.yml`의 `runs-on: ubuntu-latest`)에서 돌고, 배포는 [`infra/github-runner/`](../../github-runner/docker-compose.yml)의 self-hosted 러너가 맡는다. 아래는 GitLab 러너를 쓰던 시점의 기록이다.

## 왜 뗐나

EC2는 **`t2.xlarge`**다. 버스터블이라 지속 가능한 CPU가 4 vCPU의 22.5%, 즉 **0.9 vCPU**뿐이다.
그 이상을 계속 쓰면 크레딧이 바닥나고 하이퍼바이저가 baseline으로 조인다. 2026-08-05 `sar` 실측:

```
14:30~14:50   user 81~87%  steal  0.1%   idle  3%   ← CI가 CPU를 꽉 채워 태움
15:00         user 39%     steal 53.6%   idle  2%   ← 크레딧 소진
15:00~19:20   user 24~30%  steal 44~63%             ← 4시간 반 내내 반쪽 성능
19:30         user  7%     steal  0.9%   idle 89%   ← 부하 그치자 정상
```

그 4시간 반 동안 **같은** 프론트 스위트(120파일·1004건)가 103초에서 307초가 됐다. 테스트는
한 줄도 늘지 않았다. 이것이 "실행 시간 253배 편차"의 정체였다 — 테스트가 무거워서가 아니라
박스가 절반이 되었다 돌아왔다 한 것이다.

**속도보다 중요한 건 운영이 같이 반쪽이 됐다는 사실이다.** 라이브 강의가 같은 호스트에 있다.

용량으로 보면 더 분명하다.

```
지속 예산        3,240 vCPU초/시간
운영 상시 소비     -1,008
CI 몫             2,232 vCPU초/시간

파이프라인 1회      578 vCPU초  →  시간당 3.9회가 한계
피크 실측        4,400~7,000 vCPU초/시간  →  3.1배 초과
```

시간당 4회가 한계인 예산을 그 세 배로 쓰고 있었다. "덜 쓰기"로 맞출 수 있는 격차가 아니라서
**`test-*` 일곱 개와 `check-collisions`를 전부 옮겼다.**

## 무엇을 못 옮기나

`build`·`deploy` 계열은 **shell executor로 그 호스트에서 제자리 배포**한다. 시크릿
(`/etc/liveclass/.env.prod`)도 그 서버에만 있다. 옮길 수 없다.

`build`는 크레딧을 쓰지만(파이프라인당 약 240 vCPU초) 테스트를 걷어낸 뒤에는 예산 안에 들어온다.
대신 **테스트를 기다리지 않게** 했다(`needs: []`) — 아티팩트 의존이 없는데 스테이지 순서만으로
뒤에 서 있었다. 실측(파이프라인 169584)으로 실작업 389초짜리가 598초가 되던 자리다.

## 구성

```
lazy (8코어)
  lazy-runner-runner-1     GitLab 러너 (shell executor, concurrent 3)
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

`.gitlab-ci.yml`에서 해당 잡의 `tags`를 `[ec2-liveclass]`로 되돌리면 끝이다(잡 단위로 하나씩
되돌릴 수 있다). 이 호스트에서 `docker compose down` 하면 러너도 사라진다.

## 주의

- **가정용 회선을 탄다.** 러너는 GitLab으로 아웃바운드만 하므로 포트를 열 필요는 없지만,
  회선이 끊기면 테스트가 전부 멈춘다. 그때는 태그를 되돌리면 즉시 EC2로 돌아간다 — 다만
  EC2는 위의 크레딧 한계를 그대로 안고 있으므로 **임시 대피지이지 원상복구가 아니다.**
- **한계는 코어가 아니라 메모리다.** 8코어지만 RAM이 7.6GB뿐이고 [원격 Egress](../../livekit/remote-egress/README.md)도
  같이 돈다. 녹화 1건이 약 2GB, 동시 3잡이 약 5.5GB라 겹치면 거의 꽉 찬다. `concurrent`를 4로
  올리려면 그 전에 잡별 메모리 상한을 걸어야 한다.
- **CI와 녹화 사이에 CPU 격리가 없다.** 두 스택 모두 제한이 걸려 있지 않다. Egress는 가용 CPU를
  보고 새 녹화를 받을지 정하므로, 무거운 CI가 도는 중에는 녹화 시작이 거절될 수 있다. 아직
  실제로 겪지는 않았고 실측치도 없다.
- **프론트 스위트에 재현 안 된 플레이키가 하나 남아 있다.** 이 호스트 forks 2 리허설에서
  `InstructorLiveMediaProvider.test.tsx`의 "발행이 실패해도 미리보기는 되돌리지 않는다"가 한 번
  깨졌다. 부하를 걸고 그 파일만 10회 돌렸을 때는 10회 모두 통과해 **원인을 확정하지 못했다.**
  의심 지점은 같은 목을 쓰는 다른 발행 경로가 `mockRejectedValueOnce`를 가로채는 것인데,
  증명되지 않았으므로 추정으로 남긴다.
