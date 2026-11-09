# 원격 Egress 워커

> 관련: [../README.md](../README.md)(미디어 서버 본체) · [ADR-0010 VOD=Egress 녹화](../../../docs/decisions/songjeongki/0010-self-host-vod.md)

## 왜 떼어냈나

EC2는 4 vCPU인데 **room-composite 녹화 한 건이 그중 ~3코어를 가져간다.** 추측이 아니라
Egress가 자기 로그에 남긴 값이다.

```
기동 시      cpu available: 4.000000   max cost: 4.000000
녹화 1건 중  WARN high cpu usage  {"cpu": 0.96~1.09, "requests": 1}
```

기동 시 4.0이던 여유 CPU가 녹화 1건에 ~1.0으로 떨어진다. 남은 1코어로 backend·postgres·
rabbit·AI worker가 다 돌아야 하고, **두 번째 녹화는 여유가 모자라 아예 받지 못한다.**
메모리도 건당 1.9GB다(egress 485MB + Xvfb 104MB + Chrome 8프로세스 1.3GB).

CPU를 깎는 쪽은 이미 소진했다 — framerate는 15로 내렸고([EgressProperties](../../../backend/src/main/java/com/liveclass/video/config/EgressProperties.java)),
1080p는 "코드·슬라이드 글자가 뭉갠다"고 실측으로 정한 값이다. 남은 선택지는 옮기는 것뿐이다.

## 왜 앱을 안 고쳐도 되나

**백엔드는 Egress와 직접 말하지 않는다.**

```
백엔드 ──StartEgress──▶ LiveKit API ──Redis──▶ 등록된 Egress 노드 중 하나
```

LiveKit Egress는 애초에 별도 머신에서 도는 워커 풀로 설계돼 있다. 이 노드가 EC2의 Redis에
자기를 등록하면 LiveKit이 여유 있는 쪽에 일을 준다. `LiveKitEgressControl`도
`EgressProperties`도 그대로다.

## 무엇이 필요했나

Egress가 EC2에서 닿아야 하는 것 다섯 중 셋은 이미 공개돼 있었다.

| 필요한 것 | 상태 |
|---|---|
| 합성 템플릿 `/egress/stage` | ✅ 공개 도메인 |
| LiveKit 시그널링 | ✅ `wss://…:7443` |
| 미디어 WebRTC | ✅ `3478/udp`, 학생들이 쓰는 경로(`../livekit.yaml` `rtc.udp_port`, ADR-0078) |
| **Redis 6379** | ❌ EC2에서 `127.0.0.1` 전용, **비밀번호 없음** |
| **MinIO 9000** | ❌ EC2에서 `127.0.0.1` 전용 |

비밀번호 없는 Redis를 여는 건 논외다. **SSH 터널로 당겨온다** — EC2 쪽 방화벽도 바인드
주소도 하나도 안 바뀐다.

```
lazy                                          EC2
  egress ──127.0.0.1:16379──┐
  egress ──127.0.0.1:9000───┤ ssh -L ──▶ 127.0.0.1:6379 (Redis)
                            └──────────▶ 127.0.0.1:9000 (MinIO)
```

**9000을 EC2와 같은 번호로 잡은 게 핵심이다.** 백엔드가 Egress에 넘기는 업로드 주소가
`http://127.0.0.1:9000`이라, 번호를 맞추면 백엔드 설정 변경도 재배포도 필요 없다.
Redis는 이 호스트에서 다른 프로젝트가 6379를 물고 있어 16379로 받고 `egress.yaml`만 맞춘다.

### 터널을 왜 컨테이너로 도나

`systemd --user` 유닛은 **linger를 켜야** 로그아웃 후에도 살아남고, 그건 sudo가 필요하다.
도커는 restart 정책으로 재시작·재부팅 복구를 이미 해주고 이 호스트의 나머지도 전부 도커다.
autossh도 필요 없다 — `ServerAliveInterval` + `ExitOnForwardFailure`로 죽은 연결을 45초 안에
감지해 죽고, 도커가 되살린다.

> `unless-stopped`는 **`docker kill`로는 재시작하지 않는다** — 도커가 그걸 "사용자가 의도적으로
> 멈춤"으로 본다. 복구를 확인하려면 컨테이너 **안에서** `kill 1`로 실제 장애를 재현해야 한다.

## 셋업

**① 터널 전용 키** — 이 키로는 셸을 못 얻고 지정한 두 포트만 포워딩된다.

```bash
# 이 호스트에서
ssh-keygen -t ed25519 -N "" -C "egress-tunnel@<호스트>" -f ~/.ssh/id_egress_tunnel

# EC2의 ~/.ssh/authorized_keys 에 아래 형태로 추가 (restrict가 셸·에이전트·X11을 전부 막는다)
restrict,port-forwarding,permitopen="127.0.0.1:6379",permitopen="127.0.0.1:9000" ssh-ed25519 AAAA... egress-tunnel@<호스트>
```

**② `.env`**

```
TUNNEL_KEY=/home/<user>/.ssh/id_egress_tunnel
TUNNEL_TARGET=ubuntu@jiphyeonjeon.thdwjdrl.com
```

**③ `egress.yaml`의 `api_key`·`api_secret`** — EC2 `/etc/liveclass/livekit/egress.yaml`과
**같은 값**이어야 한다. 다르면 노드가 등록은 되지만 요청을 못 받는다.

**④ 기동**

```bash
docker compose up -d --build
```

## 확인

```bash
# 터널
docker compose ps                 # ec2-tunnel 이 (healthy)
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:9000/minio/health/live   # 200

# 노드 등록 (EC2에서)
docker exec livekit-redis-1 redis-cli HKEYS egress    # 노드가 둘이면 원격까지 붙은 것

# 실제 녹화 후 — 부하가 이쪽으로 왔는지
docker compose logs egress | grep "high cpu usage"
```

## 되돌리기

```bash
docker compose down          # 이 노드만 빠지고 EC2의 co-located egress가 그대로 받는다
```

EC2 쪽은 아무것도 안 바꿨으므로 원상복구할 것이 없다. `authorized_keys`의 터널 키 한 줄만
지우면 흔적도 남지 않는다.

## 주의

- **이 호스트가 죽으면 녹화가 EC2로 되돌아간다** — 두 노드가 다 등록돼 있는 동안은 자동
  폴백이지만, EC2 노드를 내린 뒤에는 이 호스트가 단일 장애점이다.
- **가정용 회선을 탄다.** 실측 상행 197Mbps / 하행 409Mbps에 HLS 업로드는 4.6Mbps라 여유는
  크지만, 회선이 끊기면 녹화도 끊긴다.
## 미디어는 왜 포트를 안 열어도 되나

이 호스트에서 **인바운드 포트를 열거나 포워딩할 필요가 없다.** Egress는 서버가 아니라
클라이언트다 — 안에서 밖으로 UDP를 먼저 쏘면 공유기가 NAT 매핑을 만들고 EC2의 응답이 그
구멍으로 돌아온다. 학생 브라우저가 접속하는 방식과 완전히 같다.

실측 근거:

```
이 호스트가 쓰는 UDP 포트   35201 · 46148    ← 재시작마다 바뀌는 임시 포트
EC2에 열려 있는 포트         7882/udp ALLOW Anywhere
녹화 중  UDP 수신 62/s   /   녹화 종료 후 0/s   ← 녹화 생명주기와 정확히 일치
```

EC2 입장에서 이 노드는 `prflx`(peer reflexive) 후보로 보인다 — "미리 알려준 주소가 아니라
날아온 패킷의 출발지에서 알아낸 주소"라는 뜻이고, NAT 매핑이 생겼다는 표시다.

> UDP 카운터로 확인할 때는 이 호스트의 **OpenVPN(1194/udp)과 섞이지 않는지** 봐야 한다.
> `tun0`의 수신 바이트가 0인지 함께 확인하면 갈린다.

TCP 폴백(`7881`)도 열려 있어 UDP가 막히는 망에서도 경로가 남는다. `curl`로 확인하면 안 된다 —
TLS가 아닌 포트라 연결에 성공해도 `000`이 나와 막힌 것처럼 보인다. raw TCP로 확인할 것.
