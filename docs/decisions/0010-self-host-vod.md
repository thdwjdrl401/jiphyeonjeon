# ADR-0010: VOD = LiveKit Egress 녹화 (업로드·FFmpeg 없음)

> 📍 하네스 개요: [../harness/README.md](../harness/README.md) · 아키텍처: [../ARCHITECTURE.md](../ARCHITECTURE.md)

- **상태**: 채택 (2026-07-14 개정: 완전 라이브 지향 → 업로드/FFmpeg 폐기, Egress로 통일)
- **일자**: 2026-07-14
- **관련**: [0003](0003-greenfield-redesign.md), [0004](0004-media-livekit-selfhost.md), [0012](0012-hybrid-queue.md)

## 맥락
초기에는 강사가 미리 찍은 강의를 **업로드**하는 것을 가정하고 self-host FFmpeg 트랜스코딩(→HLS)을 고려했다. 그러나 제품이 **완전 라이브 지향(업로드 강의 미지원)** 으로 확정됐다. 모든 콘텐츠는 라이브로 진행되고, 다시보기(VOD)는 그 **라이브 녹화**에서만 나온다.

## 결정
VOD/다시보기는 **LiveKit Egress**가 라이브 세션을 **녹화 → HLS → MinIO**로 만든다. **영상 업로드·FFmpeg 트랜스코드 워커는 없다.** 자료 **PPTX만 업로드**(RAG용, 영상 아님). 재생은 nginx가 HLS 서빙, **인증은 defer(seam 유지)**.

## 근거
- 업로드가 없으니 별도 트랜스코드 파이프라인이 불필요 → **미디어 경로를 LiveKit(SFU)+Egress 하나로 통일**.
- "업로드용 FFmpeg"와 "라이브 녹화용 Egress" 이중 작업이 원천 제거됨.
- 다시보기 자막은 **라이브 때 만든 transcript 재사용**(재STT 불필요), 필요 시 녹화본에 2-pass 교정.

## 대안
| 대안 | 장점 | 단점 |
|---|---|---|
| **Egress 녹화 (선택)** | 미디어 단일 경로, 이중작업 없음 | Egress 컨테이너+Redis 필요 |
| FFmpeg 업로드 트랜스코드 | 업로드 강의 지원 | **업로드 미지원 제품이라 불필요** |
| 관리형 VOD | 운영 위임 | 유료·외부 의존(self-host 방침) |

## 결정 세부
- **Egress**: LiveKit Egress(별도 컨테이너, Redis 연동)로 room composite 녹화 → HLS → MinIO. `core.video_asset`(status·`hls_manifest_key`·duration).
- **재생 인증 seam(유지)**: ① 재생 URL은 Spring 발급(`GET /lessons/{id}/playback`) ② nginx를 처음부터 경로에 ③ `PlaybackTokenService` no-op → 나중 secure_link 드롭인.

## 영향·후속
- **FFmpeg 업로드 워커 삭제**, 업로드 영상 API 제거. Egress는 **코어**(추후 아님).
- 로드맵이 **라이브-first**로 뒤집힘([CP-ROADMAP](../CP-ROADMAP.md)) — VOD는 라이브의 산출물이라 라이브 없이 존재 불가.
