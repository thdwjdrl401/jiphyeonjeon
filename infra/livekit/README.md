# 미디어 서버 — LiveKit + Egress (셋업 · 트러블슈팅 · EC2 이전)

> 관련: [../../docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) · [ADR-0004 LiveKit self-host](../../docs/decisions/0004-media-livekit-selfhost.md) · [ADR-0010 VOD=Egress 녹화](../../docs/decisions/0010-self-host-vod.md)
>
> **상태**: PoC 검증 완료(2026-07-15) — 라이브 화상 + Egress 녹화(MP4→MinIO) 성공. 임시 개인서버에서 검증했고, 실배포는 EC2. 이 문서의 값은 **템플릿**(`<...>`)이며 호스트별로 채운다.

## 1. 구성 개요

```
[학생/강사 브라우저]                          [미디어 서버 1대 (Linux)]
   │  WSS 시그널링   ──443──> nginx(TLS) ──7880──> LiveKit SFU
   │  WebRTC 미디어  ──7882/udp (직결, nginx 우회)──> LiveKit
                                                     │  (녹화 시)
                              Redis <──통신──> Egress(headless Chrome)
                                                     │  MP4
                                                  MinIO / S3
```
- **시그널링(WSS)**: `wss://<LIVEKIT_DOMAIN>` → nginx가 TLS 종료 → LiveKit `7880`(평문).
- **미디어(WebRTC UDP)**: nginx 우회, 라우터/보안그룹이 `7882/udp`를 서버로 직접 전달.
- **녹화(Egress)**: LiveKit↔Egress는 **Redis**로 통신. Egress가 헤드리스 Chrome으로 방을 합성 → MP4 → **MinIO**(PoC) / S3(EC2).
- 파일: [`docker-compose.yml`](docker-compose.yml) · [`livekit.yaml`](livekit.yaml) · [`egress.yaml`](egress.yaml) · [`request.json`](request.json)(MP4 스모크) · [`request-hls.json`](request-hls.json)(HLS·near-live, 제품용) · [`nginx-livekit.conf`](nginx-livekit.conf)
- **녹화 출력 2종**: `request.json`=단일 MP4(검증 쉬움) / `request-hls.json`=HLS 세그먼트(`segment_duration` 조절, `live_playlist_name`으로 near-live). 제품 다시보기는 **HLS**([ADR-0010](../../docs/decisions/0010-self-host-vod.md)). **EC2에서 HLS 파이프라인 검증 완료(2026-07-17)**: room-composite egress → 2초 `.ts` 세그먼트 + `index.m3u8`(VOD, EVENT)·`live.m3u8`(near-live) → MinIO `recordings/` 업로드 확인.
  - ⚠️ **request*.json에 JSON 주석(`_comment` 등) 넣지 말 것** — `lk egress start`는 요청을 엄격 파싱(protojson)이라 알 수 없는 필드가 있으면 조용히 실패한다. 파일은 egress 요청 그대로만 유지.

## 2. 채울 값 (딱 이것만)
| placeholder | 뜻 | 맞춰야 할 곳 |
|---|---|---|
| `<API_KEY>` / `<API_SECRET>` | LiveKit API 키/시크릿(`openssl rand -base64 32`) | livekit.yaml `keys` = egress.yaml `api_secret` |
| `<MINIO_USER>` / `<MINIO_PASSWORD>` | MinIO 루트 계정 | compose `MINIO_ROOT_*` = request.json `s3.access_key/secret` |
| `<LIVEKIT_DOMAIN>` | 시그널링 도메인 | nginx server_name + 클라 접속 URL |
| `<HOST_LAN_IP>` | 미디어 서버 내부 IP | nginx upstream |

> 🔒 시크릿은 서버 로컬에만. 커밋 금지. (PoC 중 채팅 노출된 값은 EC2 전 재발급.)

## 3. 셋업 순서
1. **DNS**: `<LIVEKIT_DOMAIN>` A레코드 → 서버 공인 IP.
2. **포트 개방**: 443·80·7880·7881/tcp + **7882/udp**(미디어) → 서버. (라우터 포워딩 or EC2 보안그룹)
3. **nginx**: `nginx-livekit.conf`의 ①②③ 반영 + 인증서 지정 → `sudo nginx -t && sudo systemctl reload nginx`. 확인: `curl -sI https://<LIVEKIT_DOMAIN>` → 200.
4. **시크릿 생성**: `openssl rand -base64 32` → livekit.yaml·egress.yaml에 동일 반영.
5. **기동**: `docker compose up -d` → `docker compose ps`로 4개(livekit·redis·egress·minio) 확인.
6. **버킷**: 
   ```bash
   docker run --rm --network host --entrypoint /bin/sh minio/mc:RELEASE.2025-08-13T08-35-41Z \
     -c "mc alias set local http://localhost:9000 <MINIO_USER> <MINIO_PASSWORD> && mc mb -p local/recordings"
   ```
7. **CLI 설치**: `curl -sSL https://get.livekit.io/cli | sudo bash` (jq 필요: `apt install -y jq`).

## 4. 테스트
```bash
# 프로젝트 등록 (유저 홈에 저장 — root로 하면 클라우드 인증으로 샘, 주의)
lk project add --url ws://localhost:7880 --api-key <API_KEY> --api-secret <API_SECRET> media

# ① 화상 검증: 토큰 발급 → meet.livekit.io/custom 에서 wss://<LIVEKIT_DOMAIN> + 토큰
lk token create --api-key <API_KEY> --api-secret <API_SECRET> --join --room test --identity a --valid-for 24h
#   ⚠️ 서버와 같은 wifi에서 테스트하면 헤어핀으로 미디어 실패 → 외부망(LTE)에서 검증 (트러블슈팅 #2)

# ② 녹화 검증: publisher 띄우고(방에 트랙 있어야) → egress
lk room join --url ws://localhost:7880 --api-key <API_KEY> --api-secret <API_SECRET> --room test --identity bot --publish-demo   # 터미널1
lk egress start --type room-composite "$(cat request.json)"                                                                     # 터미널2
lk egress list                       # EGRESS_ACTIVE → stop 후 EGRESS_COMPLETE
lk egress stop --id <EgressID>
docker run --rm --network host --entrypoint /bin/sh minio/mc:RELEASE.2025-08-13T08-35-41Z \
  -c "mc alias set local http://localhost:9000 <MINIO_USER> <MINIO_PASSWORD> && mc ls local/recordings"   # test-recording.mp4
```

## 5. 트러블슈팅 로그 (실제로 뚫은 벽들 — 원인·이유 포함)

| # | 증상 | 원인 | 해결 | 왜 |
|---|---|---|---|---|
| **1** | 브라우저 `ERR_CERT_COMMON_NAME_INVALID`, WS 실패 | nginx가 livekit 서브도메인에 **다른 도메인 인증서**를 내줌 | 그 443 블록에 `<LIVEKIT_DOMAIN>` 커버하는 `ssl_certificate` 지정(와일드카드 or 발급) | ssl_certificate 미지정 시 nginx가 기본 서버 cert로 폴백 → CN 불일치. `curl -k`는 검증 skip이라 통과해 헷갈림 |
| **2** | 같은 wifi 클라만 화상 안 붙음(ICE 전부 failed) | livekit이 **공인 IP만** 광고 → 같은 LAN 클라가 공인 IP로 미디어 보내면 라우터 헤어핀 실패 | **외부망(LTE)에서 테스트** | 실사용자는 전부 외부망이라 정상. 같은-LAN 테스트가 함정. (co-located는 #4로 해결) |
| **3** | egress `page load error: websocket url timeout reached` (정확히 20초, Chrome 안 뜸) | Docker 기본 seccomp이 Chrome 프로세스 초기화 차단 → chromedp가 Chrome의 CDP 디버그 소켓을 20초 내 못 읽음 (ICE/시그널 무관!) | egress `security_opt: ["seccomp=unconfined"]` | SYS_ADMIN·shm 1g·리소스 다 정상인데도 seccomp이 syscall 막음. chromedp 기본 타임아웃이 20s라 로그가 딱 20초 |
| **4** | egress `Start signal not received` (recorder 미디어 못 받음) | livekit이 **공인 IP만** 광고 → 같은 호스트의 recorder가 헤어핀 실패. STUN self-ping도 홈NAT에서 실패("could not validate external IP: context canceled") | livekit **v1.13.3** + `advertise_internal_ip: true` + `skip_external_ip_validation: true` | 이 플래그가 **내부 IP + 공인 IP 둘 다** 후보로 광고(≥v1.13.0). 구버전(v1.9.1)은 플래그 무시 → 반드시 업글 |
| **5** | #4 고쳐도 `Start signal not received` 지속 | recorder가 `wss://도메인`(nginx 경유)로 방 접속 시도 → co-located인데 굳이 헤어핀 경로 | egress `ws_url: ws://localhost:7880` + `insecure: true` | recorder는 서버 안에 있으니 **로컬 직결**이 정석. 시그널 localhost + 미디어 내부IP로 전부 로컬 경로 → 성공 |

**보조 확인 팁**
- 접속 실패 시 **livekit 로그의 `starting RTC session`** 유무로 시그널/미디어를 가름 (뜨면 시그널 OK·미디어 문제, 없으면 시그널 문제).
- `docker inspect $(docker compose ps -q egress) --format '{{.HostConfig.ShmSize}}'` → `1073741824`(1g) 확인.
- `libcuda.so.1` 경고는 GPU 없어 나는 무해한 로그(무시).
- Egress는 **방에 publish 중인 트랙이 있어야** 녹화 시작(빈 방은 `Start signal not received`).

## 6. EC2 이전 가이드

**같은 것**: compose 구조·livekit.yaml·egress.yaml·nginx 스니펫·트러블슈팅 #3~#5의 fix 전부 그대로.

**바꾸는 것**:
| 항목 | 개인서버(PoC) | EC2 |
|---|---|---|
| 스토리지 sink | MinIO(compose) | **실 AWS S3** — `request.json`의 `s3`에서 `endpoint`·`force_path_style` 제거, 실 `bucket`·`region`(ap-northeast-2)·IAM 키 |
| 포트 개방 | 라우터 포워딩 | **보안그룹 인바운드** (443·80·7880·7881/tcp, 7882/udp) |
| 공인 IP | 홈 NAT 뒤 | EC2 퍼블릭 IP 직접 |
| 헤어핀 | 문제됨(#2·#4) | 덜함(퍼블릭 IP 직접) — 그래도 co-located egress 위해 `advertise_internal_ip` 유지 권장 |
| MinIO | 필요 | 제거(S3 사용) |
| 시크릿 | 재발급 | Secrets Manager/SSM 등 |

**EC2 실배포 확정 구성 (ADR-0015 연계)**: 앱(`jiphyeonjeon.thdwjdrl.com`)이 이미 443을 점유하고 단일 도메인·DNS 콘솔 권한이 없으므로, 미디어 시그널링은 **별도 TLS 포트**로 분리한다.
- 이 compose에 **`nginx-livekit` 서비스**(`nginx-livekit-prod.conf`, `network_mode: host`) 추가 → `wss://jiphyeonjeon.thdwjdrl.com:7443` 종단 후 livekit 7880으로 프록시. (앱 nginx에 스니펫을 합치지 않고 미디어 스택이 독립 운영.)
- **인증서 공유**: 앱 스택(`docker-compose.prod.yml`)의 certbot이 발급한 볼륨 `liveclass_certbot_etc`를 `external`로 읽기전용 마운트. → **앱 스택을 먼저 기동**해 cert가 있어야 미디어 nginx가 뜬다. 갱신은 앱 certbot이, 미디어 nginx는 6h마다 reload.
- **보안그룹**: `7443/tcp`(시그널) + `7882/udp`(미디어) + `7881/tcp`(fallback). `7880`은 미노출(내부).
- **클라이언트 접속 URL**: `wss://jiphyeonjeon.thdwjdrl.com:7443`.
- **기동**: `docker compose -f infra/livekit/docker-compose.yml up -d` (앱 스택·인증서 준비 후).

**사양**: Egress(Chrome) 때문에 **4 vCPU / 4GB 이상** 권장. 라이브만이면 더 작아도 됨.

**MinIO 주의**: 커뮤니티 에디션이 유지보수 모드(2025-10 이후 Docker Hub 이미지 동결). PoC는 태그 고정으로 OK, EC2는 실 S3라 무관.

## 7. 앱(Spring) 연동 지점 (CP1/CP4)
- **LiveKit 토큰 발급**: Spring이 `<API_KEY>`/`<API_SECRET>`로 JWT 서명(방·권한 grant) → FE에 전달.
- **Egress 제어**: Spring이 강의 시작 시 `StartRoomCompositeEgress`(request.json 형태), 종료 시 `StopEgress`. sink는 요청마다 지정.
- **다시보기**: 녹화된 HLS/MP4를 nginx로 서빙([ADR-0010](../../docs/decisions/0010-self-host-vod.md) 재생 seam).
