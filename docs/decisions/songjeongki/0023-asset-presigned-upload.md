# ADR-0023: 파일 업로드 = presigned 직접 업로드 + 범용 asset

> 📍 하네스 개요: [../harness/README.md](../../harness/README.md) · 아키텍처: [../ARCHITECTURE.md](../../ARCHITECTURE.md) · 계약: [../CONTRACT.md](../../CONTRACT.md)

- **상태**: 채택
- **일자**: 2026-07-21
- **관련**: [0017](0017-schema-ownership-core-ai.md)(스키마 소유권 — asset은 core)

## 맥락
- FE가 커리큘럼 **썸네일 이미지**(생성/수정 폼)와 향후 **프로필 사진** 업로드를 필요로 한다. FE 계약(`CURRICULUM_MANAGEMENT.md`)은 presigned 직접 업로드 방식을 제안하고, `apiClient`엔 multipart 헬퍼가 없다(바이트가 Spring을 거치지 않는 전제).
- DDL은 이미 **범용 asset**로 설계돼 있다: 단일 `core.asset(kind∈{PROFILE_IMAGE,THUMBNAIL,MATERIAL}, bucket, object_key[비공개], content_type, size_bytes, status∈{PENDING,UPLOADED,FAILED,DELETED}, uploaded_by)` + 소비자별 FK(`curriculum.thumbnail_asset_id`, `app_user.profile_image_asset_id`, `material_asset.asset_id`). 엔티티만 있고 구현은 없었다.

## 결정
1. **presigned 직접 업로드(2단계).** `POST /api/assets/upload-requests`가 PENDING asset을 만들고 presigned PUT URL을 발급 → 클라이언트가 스토리지에 **직접 PUT** → `POST /api/assets/{id}/complete`가 확인 후 UPLOADED로 전이. 바이트는 백엔드를 거치지 않는다.
2. **범용 asset + 범용 엔드포인트.** 썸네일·프로필은 `kind` 파라미터만 다른 **동일 `/api/assets/*` API**를 재사용한다. 소비자는 발급받은 `assetId`를 자기 FK로 연결(`thumbnailAssetId`, `PUT /api/me/profile-image {assetId}`). MATERIAL(PPTX)은 이번 범위 밖이나 같은 코어를 재사용할 수 있게 열어둔다.
3. **스토리지 seam.** `AssetStorage` 인터페이스(presignUpload/presignDownload/head) → 실구현 `S3AssetStorage`(AWS SDK v2 S3, MinIO 호환·path-style). 테스트는 이 seam을 목으로 대체해 **실제 MinIO 없이** 계약 검증이 돈다.
4. **읽기 노출 = 온디맨드 서명 URL.** `object_key`는 서버가 생성(`kind/{assetId}`)·비공개. 조회 시 서버가 `thumbnail_asset_id`/`profile_image_asset_id`를 presigned GET URL로 변환해 응답의 `thumbnailUrl`/`profileImageUrl`로 내려준다(목록은 배치).
5. **인가·검증.** kind별 역할(THUMBNAIL→강사, PROFILE_IMAGE→로그인 사용자, MATERIAL→차단), 소유권(`uploadedBy`) 검증을 complete·썸네일 연결·프로필 연결 3곳 모두에서. **크기·타입은 신고값이 아니라 실측으로 강제**한다: presign에 `contentLength`를 서명(초과 PUT 차단) + `complete`에서 HEAD로 실제 크기·content-type 재검증(불일치 거부, 5MiB·이미지 타입 화이트리스트, `image/svg+xml` 제외).

## 근거
- 바이트가 Spring 힙·대역을 거치지 않아 **메모리·확장성**에 유리하고, 계약(apiClient multipart 없음)과 정합.
- 하나의 asset 테이블·상태기계·스토리지 seam으로 **썸네일·프로필·자료의 중복 제거** — 프로필은 `kind=PROFILE_IMAGE`로 동일 코어를 그대로 쓴다.
- seam 덕에 스토리지 인프라 없이 **테스트가 격리**되고, 실업로드만 EC2 MinIO로 검증.
- object_key 서버 생성 + 소유권/크기/타입 실측 강제로 경로주입·타 사용자 도용·스토리지 남용을 차단.

## 대안
| 대안 | 장점 | 단점 |
|---|---|---|
| **presigned 직접 + 범용 asset (선택)** | 바이트 우회·범용·seam 테스트·계약 정합 | 2단계(요청·완료) 상태 관리 필요 |
| Spring 경유 multipart 업로드 | 단순·서버 검증 용이 | 힙·대역 부담, 확장 불리, apiClient 계약과 불일치 |
| kind별 별도 테이블/파이프라인 | 도메인 결합 명확 | 중복(업로드·상태·스토리지 3벌), 범용성 상실 |
| 공개 버킷 + 공개 URL | 읽기 단순 | 비공개 자산 권한 통제 불가 |

## 영향·후속
- **MATERIAL(PPTX)**: 같은 asset 코어를 재사용하되 자료 업로드·AI 준비(임베딩)는 CP2 파이프라인에서(별도). 이번엔 THUMBNAIL/PROFILE_IMAGE만 배선.
- **정리·강건화(후속)**: 미완료 PENDING asset 리퍼(orphan cleanup)·FAILED 전이, presigned PUT의 TTL 내 재사용(동일 소유자) 제한, 읽기 URL의 CDN/캐시 최적화(현재는 매 조회 presigned GET, 만료 있음).
- **운영**: `asset.storage.*`(endpoint·bucket·키)는 env 주입. dev 기본은 로컬 MinIO(`minioadmin`), 운영은 EC2 MinIO 자격을 env로. 버킷은 Egress 녹화와 별개.
