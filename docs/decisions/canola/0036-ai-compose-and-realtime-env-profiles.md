# ADR-0036: AI compose 대칭과 realtime-agent 환경 profile 분리

- 상태: 승인
- 일자: 2026-07-31

## 맥락

EC2의 prod `ai-api`·`ai-worker`는 Spring과 같은 Docker network에 있어 host port 없이도
서비스 통신은 됐다. 하지만 host loopback에 관리 port가 없어 운영 probe 계약과 달랐고,
dev network에는 Spring container가 없어 dev `ai-api`에 외부에서 도달할 경로도 없었다.

realtime-agent는 prod와 dev의 LiveKit·TURN 연결 값을 중복하면서 provider와 관계없는
Nemotron·OpenAI 변수까지 같이 실었다. 코드 기본값과 같다는 이유로 운영 정책 값을 생략하면
배포 의도와 런타임 기본값을 구분할 수 없다.

## 결정

1. `docker-compose.ai-prod.yml`과 `docker-compose.ai-dev.yml`은 같은 서비스 구조, replica,
   graceful shutdown, healthcheck와 강의 노트 정책 키를 유지한다.
2. container port는 모두 `8010/8011`로 유지하고 host에는 loopback으로만 게시한다.
   prod는 `127.0.0.1:8010/8011`, dev는 `127.0.0.1:18010/18011`을 쓴다.
3. port forwarding이 container process에 도달하도록 container 내부 bind는 `0.0.0.0`으로
   설정하되 host publish 주소를 `127.0.0.1`로 제한한다.
4. 운영 정책 값은 코드·compose 기본값과 같아도 env 예시에 명시한다. 필수 값은
   compose 렌더링 단계에서 누락을 거부한다.
5. dev Docker network에 Spring이 없으므로 `AI_WORKER_SPRING_INTERNAL_BASE_URL`은 환경별
   필수 값으로 주입한다. prod는 `http://backend:8080`을 명시한다.
6. realtime-agent는 `realtime-agent-common.env`에 LiveKit·TURN·공통 운영 정책을 두고,
   prod/dev profile에 provider에 필요한 값만 둔다. prod는 local Nemotron `12/12`, dev는
   OpenAI Realtime `1/1`을 쓴다.

## 결과

- EC2 운영 probe와 SSH local forward가 가능하지만 AI 관리 endpoint는 public interface에
  노출되지 않는다.
- dev와 prod를 동시에 올려도 host port가 충돌하지 않는다.
- dev worker는 도달 가능한 Spring 주소가 없으면 compose config 단계에서 fail-closed한다.
- provider 전환 시 대상 profile만 바꾸고 `restart-agent-prod|dev`로 해당 process만 재시작한다.
- 배포전 실제 시크릿 env에 공통 파일을 추가하고 기존 중복·provider 미사용 키를
  제거하는 migration이 필요하다.
