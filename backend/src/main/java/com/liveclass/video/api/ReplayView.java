package com.liveclass.video.api;

import java.util.UUID;

/**
 * video 모듈이 공개하는 다시보기 표현. 녹화본이 있는 레슨만 나온다 — 녹화 자체가 없으면 조회 결과에서
 * 빠지고, 소비자가 그 부재를 자기 표현(예: 카탈로그의 NOT_READY)으로 옮긴다.
 *
 * @param replayStatus DRAFT·READY_FOR_REVIEW·PUBLISHED·WITHDRAWN (게시 검수 흐름은 후속)
 * @param durationMs   재생 길이. 녹화 완료 webhook(FINALIZING→VERIFYING→READY)이 아직 없어 현재는 null
 */
public record ReplayView(
        UUID lessonId,
        UUID liveSessionId,
        String replayStatus,
        Long durationMs
) {
}
