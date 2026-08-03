package com.liveclass.video.api;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * 녹화가 실패했다. 강사가 <b>놓치면 안 되는</b> 사건이라 중요도가 ERROR다 — 다시 찍지 않으면
 * 그 회차는 영영 다시 볼 수 없다.
 *
 * @param failureCode 원인 코드(EGRESS_FAILED·MANIFEST_MISSING 등). 문구에 그대로 넣지 않는다 —
 *                    강사에게 의미 있는 말은 "녹화가 실패했다"이고, 코드는 우리가 볼 값이다.
 */
public record RecordingFailedEvent(
        UUID videoAssetId,
        UUID lessonId,
        UUID liveSessionId,
        String failureCode,
        OffsetDateTime occurredAt
) {
}
