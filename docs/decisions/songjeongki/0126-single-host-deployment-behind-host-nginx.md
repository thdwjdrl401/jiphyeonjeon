# ADR-0126: 배포 호스트의 nginx가 단일 엔트리다

- **상태**: 채택 — lazy 배포에 반영
- **일자**: 2026-08-15
- **관련**: [0015](0015-docker-deploy-fe-be-nginx.md)(FE·BE·nginx 도커 배포),
  [0125](0125-bge-runtime-accepts-cpu-device.md)(BGE CPU),
  [0023](../canola/0023-asset-storage-presigned.md)(MinIO presigned 에셋)
- **적용 범위**: `docker-compose.lazy.yml`, `infra/nginx/frontend-behind-host-proxy.conf`,
  `docker-compose.prod.yml`·`infra/livekit/docker-compose.yml`의 시크릿 경로

## 한 줄 결정

배포 호스트의 nginx가 80·443을 **혼자** 쥐고 TLS를 종단한다. 앱 프론트엔드 컨테이너는 루프백
8100에 평문으로만 뜨고, 컨테이너 nginx는 도커 네트워크 안쪽 라우팅만 맡는다.

## 맥락

전용 인스턴스에서는 앱 스택이 호스트의 유일한 거주자였다. 프론트엔드 컨테이너가 80·443을 직접
잡고 certbot으로 인증서를 발급받는 구성이 자연스러웠다.

새 배포 호스트는 사정이 다르다. 그 호스트의 nginx가 이미 다른 서비스들을 여러 도메인으로 서빙하고
있고 certbot도 호스트에서 돈다. 컨테이너가 80·443을 잡으려 하면 애초에 뜨지 못한다.

## 결정

**호스트 nginx = TLS 종단 + 도메인 분배. 컨테이너 nginx = 내부 라우팅.**

컨테이너 nginx를 없애지 않는다. `/api/`는 `backend:8080`으로, `/liveclass-assets/`·`/recordings/`는
`minio:9000`으로 가야 하는데 그건 **도커 네트워크 안의 이름**이라 호스트에서 해석할 수 없다.
두 nginx는 역할이 겹치지 않는다 — 하나는 밖을, 하나는 안을 본다.

`docker-compose.lazy.yml`이 prod 정의에 얹는 것은 셋뿐이다: 포트를 `127.0.0.1:8100:80`으로,
서버 블록을 평문 HTTP용으로, certbot을 끈다.

### 호스트가 반드시 지켜야 할 것 — `Host` 헤더

MinIO presigned URL은 **공개 도메인 Host로 SigV4 서명**된다. 호스트 nginx가 `Host`를 바꾸면
서명 검증이 깨져 업로드와 재생이 통째로 죽는다. `proxy_set_header Host $host`가 선택이 아니다.

### 시크릿 경로를 설정 가능하게

`/etc/liveclass/...`를 절대경로로 물고 있던 다섯 곳을 `${LIVECLASS_SECRETS_DIR:-/etc/liveclass}`로
바꿨다. 기본값이 옛 경로라 기존 배포는 그대로 동작한다.

새 호스트에서는 시크릿을 사용자 홈(`~/secrets`, mode 700)에 둔다. `/etc` 아래에 쓰려면 root가
필요한데, 이 호스트의 배포는 root 없이 도는 것이 원칙이다 — 러너도 배포도 일반 사용자다.
**저장소가 특정 호스트의 파일시스템 배치를 가정하지 않게 된 것**이 부수 이득이다.

## 대안

**컨테이너 nginx가 계속 엣지를 맡고, 호스트의 기존 사이트들을 컨테이너 설정으로 흡수** — 앱과
무관한 서비스들(포트폴리오 등)의 설정이 앱 저장소로 들어온다. 앱을 재배포할 때마다 무관한
사이트가 함께 흔들린다.

**호스트 nginx를 걷어내고 컨테이너에 전부 맡김** — 그 호스트의 다른 서비스를 전부 컨테이너화해야
한다. 이번 이전의 범위를 한참 넘는다.

## 영향·후속

- 인증서 발급·갱신은 **호스트 certbot 하나**가 맡는다. 앱 스택의 certbot을 같이 띄우면 같은
  웹루트를 두고 다투다 갱신이 조용히 실패한다 — 그래서 프로파일로 꺼 둔다.
- 프론트엔드 컨테이너는 이제 인증서를 읽지 않는다. TLS 관련 실패는 전부 호스트 쪽에서 본다.
- `X-Forwarded-Proto https`는 컨테이너의 `app-locations.conf`가 이미 붙이고 있어 백엔드의
  쿠키 Secure·스킴 인식은 그대로다.
- LiveKit은 이 경로를 타지 않는다. 시그널링(7443)과 미디어(UDP)는 호스트에 직접 바인딩되며,
  브라우저의 `/livekit/` WebSocket만 컨테이너 nginx가 `host.docker.internal:7880`으로 넘긴다.

## 실제로 옮기면서 걸린 것들

전부 "한 호스트에 몰아넣으니 드러난" 종류다. 기록해 두는 이유는 다음에 같은 자리에서 다시 밟기 때문이다.

**컨테이너에서 본 `host.docker.internal`은 브리지 게이트웨이다.** 호스트의 `127.0.0.1` 바인드에는
닿지 않는다. BGE를 루프백에만 열었더니 ai-worker의 readiness가 영원히 false였다 — 컨테이너끼리는
같은 네트워크에 붙여 서비스명으로 부르는 게 맞다.

**브리지 게이트웨이 IP는 호스트마다 다르다.** `EGRESS_PURGER_BASE_URL`이 옛 호스트의 172.18.0.1을
가리키고 있었다(여기는 172.24.0.1). 하드코딩 대신 host-gateway로 매핑된 도메인 이름을 쓴다.

**포트는 공유기와 ufw 둘 다 열어야 한다.** 공유기만 열고 "포워딩했는데 왜 안 되지"로 한참 헤맸다.
브리지→호스트도 마찬가지다 — `/livekit` 경로가 그 홉에서 죽으면 강사가 방에 못 붙고, 그 결과는
"라이브 시작이 안 됨"으로 나타난다. `live_start_attempt` 행조차 남지 않아 원인이 안 보인다.

**LiveKit 시그널링의 `join_request`는 URI가 10KB를 넘는다.** nginx 기본
`large_client_header_buffers`(4×8k)가 그 요청 줄을 담지 못하고 연결을 조용히 끊는다.
실측: 3,000자 통과, 9,000자 끊김. **Egress recorder가 방 전체를 구독해서 가장 길다** — 브라우저는
자기 트랙만 구독해 대체로 8k 밑이라, *사람은 들어가지는데 녹화만 안 붙는* 모습이 된다.
증상이 원인과 멀어서 엉뚱한 데를 파게 만드는 종류다.

**합성 템플릿이 HTTPS면 egress의 `ws_url`도 wss여야 한다.** 평문 `ws://`는 브라우저가 혼합
콘텐츠로 막는다. co-located라고 `ws://localhost`를 쓰던 설정은 템플릿이 HTTP로 서빙되던 시절 전제다.

**호스트 nginx는 1.18이다.** `http2 on;`(1.25.1+)을 쓰면 기동을 거부한다. 컨테이너(alpine, 최신)
설정을 그대로 옮기면 여기서 걸린다. 호스트용 설정은 `nginx:1.18` 이미지로 문법 검사하고 올린다.
