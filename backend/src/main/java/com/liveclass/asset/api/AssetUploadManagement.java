package com.liveclass.asset.api;

import java.time.OffsetDateTime;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * 도메인 전용 업로드 흐름이 사용하는 내부 포트. 외부 generic asset API에 영상 kind를 열지 않고도
 * video 모듈이 같은 presigned 저장 구현을 재사용할 수 있게 한다.
 */
public interface AssetUploadManagement {

    UploadTicket createRecordedVideoSource(String fileName, String contentType, long fileSize, UUID uploaderId);

    AssetRef completeRecordedVideoSource(UUID assetId, UUID requesterId);

    void abandonPendingRecordedVideoSource(UUID assetId, UUID requesterId);

    /** 녹화강의 삭제 시 원본 에셋 행을 지우고, 실제 객체는 호출 트랜잭션 커밋 뒤 정리한다. */
    void deleteRecordedVideoSource(UUID assetId);

    Optional<String> resolveRecordedVideoSourceUrl(UUID assetId);

    record UploadTicket(
            UUID assetId,
            String uploadUrl,
            String method,
            Map<String, String> headers,
            OffsetDateTime expiresAt
    ) {
    }
}
