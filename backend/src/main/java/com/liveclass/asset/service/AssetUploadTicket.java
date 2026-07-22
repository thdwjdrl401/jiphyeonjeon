package com.liveclass.asset.service;

import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;

/**
 * presigned 업로드 발급 결과. 클라이언트는 이 uploadUrl에 method(PUT)로, headers를 붙여
 * 바이트를 직접 올린 뒤 /api/assets/{assetId}/complete를 호출한다.
 */
public record AssetUploadTicket(
        UUID assetId,
        String uploadUrl,
        String method,
        Map<String, String> headers,
        OffsetDateTime expiresAt
) {
}
