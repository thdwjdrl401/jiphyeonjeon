package com.liveclass.video.api;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * 녹화가 준비됐다. <b>강사에게만</b> 가는 사건이다 — 검수하고 공개할 사람이 강사다.
 *
 * <p>수신자를 싣지 않는다. 녹화 자산은 강사를 모르고 라이브 세션이 안다. 그것을 발행 시점에
 * 조회하면 webhook 처리 트랜잭션이 그만큼 길어지므로, 찾는 일은 워커에 맡긴다(ADR-0073 §3).
 */
public record RecordingReadyEvent(
        UUID videoAssetId,
        UUID lessonId,
        UUID liveSessionId,
        /**
         * 녹화 길이. <b>진도 환산의 분모</b>다(ADR-0117) — 라이브 중에는 이 값이 없어서 진도가
         * 나가지 않는데, 준비되는 이 순간이 그 값이 처음 생기는 자리다. 알 수 없으면 null.
         */
        Long durationMs,
        OffsetDateTime occurredAt
) {
}
