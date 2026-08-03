package com.liveclass.video.api;

import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;

public record RecordedUploadTicket(
        UUID assetId,
        String uploadUrl,
        String method,
        Map<String, String> headers,
        OffsetDateTime expiresAt
) {
}
