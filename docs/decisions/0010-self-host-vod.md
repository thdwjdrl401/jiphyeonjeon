# ADR-0010: VOD는 self-host 트랜스코딩 (HLS·FFmpeg·nginx·MinIO)

> 📍 하네스 개요: [../harness/README.md](../harness/README.md) · 아키텍처: [../ARCHITECTURE.md](../ARCHITECTURE.md)

- **상태**: 채택
- **일자**: 2026-07-14
- **관련**: [0004](0004-media-livekit-selfhost.md), [0012](0012-hybrid-queue.md)

## 맥락
기획서는 P1 VOD에 **관리형 VOD(Mux/AWS 등)** 를 권장(트랜스코딩·CDN·signed playback 위임). 하지만 우리는 **self-host** 방침(비용·계정 제약).

## 결정
VOD를 **self-host**로 처리한다: 업로드=presigned direct→MinIO, 트랜스코딩=**FFmpeg 워커(RabbitMQ 잡)**→HLS→MinIO, 서빙=**nginx**(HLS 게이트). 재생 **인증은 defer(seam만)**.

## 근거
- 관리형 VOD는 유료·외부 의존 → 데모 제약. self-host로 통일(LiveKit도 self-host).
- HLS는 되감기·시점이동·자막 동기·적응화질에 필요(제품 핵심). 원본 mp4 직서빙은 seek·확장 한계.
- 영상 바이트는 Spring/Python 통과 금지(대역폭) → nginx가 직접 서빙.

## 결정 세부
- **트랜스코드**: 전용 FFmpeg 워커(CPU 격리). **단일 720p 시작**, `video_rendition` 구조는 분리해 ABR 확장 대비.
- **HLS 서빙/인증**: 데모는 nginx 무인증 패스스루. **인증 seam 3개** 유지 — ① 재생 URL은 Spring 발급(`GET /lessons/{id}/playback`) ② nginx를 처음부터 경로에 ③ `PlaybackTokenService` no-op. 나중에 nginx secure_link/auth_request만 켜면 드롭인.
- **메타**: `core.video_asset`(status·`hls_manifest_key`·duration) + `video_rendition`. 개별 세그먼트는 DB 아님(MinIO+m3u8).

## 대안
| 대안 | 장점 | 단점 |
|---|---|---|
| **self-host (선택)** | 비용·제어, 스택 통일 | 트랜스코딩·서빙 직접 운영 |
| 관리형 VOD | 운영 위임·ABR·CDN | 유료·외부 의존 |
| 원본 mp4 직서빙 | 최속 개발 | seek·적응화질·확장 한계 |

## 영향·후속
- FFmpeg 워커·nginx가 인프라에 추가. self-host Docker Compose 구성 필요.
- HLS 서빙 인증(secure_link/auth_request)은 나중 활성.
