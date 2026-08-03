package com.liveclass.video.api;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * 다시보기가 공개됐다. 그 커리큘럼을 <b>수강 중인 학생 전원</b>이 알아야 한다.
 *
 * <p>두 경로에서 난다 — Egress 완료로 <b>자동 공개</b>될 때(DRAFT → PUBLISHED)와 강사가 <b>직접
 * 공개</b>할 때. 둘은 학생 입장에서 같은 일이라 사건도 하나다.
 */
public record ReplayPublishedEvent(
        UUID videoAssetId,
        UUID lessonId,
        UUID liveSessionId,
        OffsetDateTime occurredAt
) {
}
