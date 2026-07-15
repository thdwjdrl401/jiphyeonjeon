# LiveKit 미디어 서버 — 설치·가동·테스트 런북

> 개인서버(`192.168.219.124`, 앞단 nginx가 TLS 종료). **화상 먼저**, Egress(녹화)는 다음 단계.
> 관련: [../../docs/T0-BOOTSTRAP.md](../../docs/T0-BOOTSTRAP.md) §3 · [../../docs/decisions/0004-media-livekit-selfhost.md](../../docs/decisions/0004-media-livekit-selfhost.md)

## 구조
- **시그널링(WSS)**: `wss://livekit.thdwjdrl.com` → nginx(TLS 종료) → LiveKit `7880`(평문)
- **미디어(WebRTC UDP)**: nginx 우회 → 라우터가 `7882/udp`를 서버로 직접 포워딩

---

## 0. 사전 준비 (서버)
- Docker + docker compose 설치 확인: `docker --version && docker compose version`
- 이 디렉토리(`infra/livekit/`)를 서버로 복사(또는 레포 clone).

## 1. API 키/시크릿 생성
```bash
# key는 임의 식별자, secret은 강한 랜덤(JWT HS256 서명에 사용)
echo "APIdev: $(openssl rand -base64 32)"
```
출력값을 `livekit.yaml`의 `keys:` 에 넣는다. **secret은 커밋 금지** — 서버 로컬에만.

## 2. config 확인 — `livekit.yaml`
- `keys:` 에 1에서 만든 key/secret
- `rtc.udp_port: 7882`, `rtc.tcp_port: 7881`, `rtc.use_external_ip: true`
- `port: 7880` (nginx가 TLS 종료하므로 평문)

## 3. 가동
```bash
docker compose up -d
docker compose logs -f livekit      # "starting LiveKit server" + 에러 없음, 감지된 IP 확인
```
로컬 헬스: `curl -s http://localhost:7880` → `OK`

## 4. nginx 프록시 추가
`nginx-livekit.conf`의 ①②③를 서버 nginx에 반영:
```bash
sudo nginx -t && sudo systemctl reload nginx
curl -s https://livekit.thdwjdrl.com    # → OK  (nginx→livekit 경로 확인)
```
- ⚠️ 인증서가 `livekit.thdwjdrl.com`을 커버해야 함(와일드카드 `*.thdwjdrl.com`이면 OK, 아니면 발급).

## 5. 라우터 포트포워딩 (nginx 우회, 직접)
`192.168.219.124` 로:
| 포트 | 프로토콜 | 용도 |
|---|---|---|
| 7882 | UDP | 미디어 (필수) |
| 7881 | TCP | UDP 막힌 클라 fallback (권장) |

443(WSS)은 이미 nginx가 받으니 추가 불필요.

## 6. 테스트 (Spring 없이)
LiveKit CLI 설치:
```bash
curl -sSL https://get.livekit.io/cli | bash
```
참가 토큰 2개 생성(다른 identity):
```bash
lk token create --api-key APIdev --api-secret <SECRET> \
  --join --room test --identity userA --valid-for 24h
lk token create --api-key APIdev --api-secret <SECRET> \
  --join --room test --identity userB --valid-for 24h
```
브라우저 테스트:
1. [meet.livekit.io/custom](https://meet.livekit.io/custom) 접속
2. Server URL = `wss://livekit.thdwjdrl.com`, Token = userA → 입장
3. 다른 탭/기기에서 userB로 입장 → **서로 화상·오디오 보이면 성공**

## 7. 트러블슈팅
| 증상 | 원인 후보 |
|---|---|
| 입장 자체 실패(연결 안 됨) | nginx WS 프록시/인증서, `7880` 미기동, `curl https://livekit...` 실패 |
| 입장은 되는데 화상 안 옴 | **`7882/udp` 포워딩 누락**, `use_external_ip` 오탐 → `chrome://webrtc-internals`로 ICE 확인 |
| 인증서 오류 | cert가 `livekit.thdwjdrl.com` 미포함 |

## 다음 단계 (녹화)
Egress 추가 시: `docker-compose.yml`에 `redis` + `livekit/egress` 서비스 추가, `livekit.yaml`은 그대로(egress 블록 없음), Egress가 Redis 공유 + `cap_add: SYS_ADMIN` 필요. S3/MinIO sink 지정. → [../../docs/T0-BOOTSTRAP.md](../../docs/T0-BOOTSTRAP.md) §3-6.
