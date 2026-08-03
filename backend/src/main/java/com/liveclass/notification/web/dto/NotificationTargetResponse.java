package com.liveclass.notification.web.dto;

import com.liveclass.notification.service.NotificationTargetResolution;
import io.swagger.v3.oas.annotations.media.Schema;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * 클릭 시점의 대상 판정(CONTRACT §2-4).
 *
 * <p>둘을 <b>한 응답 모양</b>에 담는다 — {@code status}가 갈림길이고, 나머지 한쪽은 null이다.
 * 대상이 사라진 것은 <b>오류가 아니라 정상 200</b>이다. 404로 주면 화면이 "삭제된 강의입니다"와
 * "잠시 후 다시 시도해 주세요"를 구별하지 못한다.
 */
@Schema(description = "알림 클릭 대상의 현재 상태")
public record NotificationTargetResponse(
        @Schema(description = "AVAILABLE 또는 GONE") String status,
        @Schema(description = "AVAILABLE일 때의 대상 상태") State state,
        @Schema(description = "GONE일 때의 이유") String reasonCode
) {

    @Schema(description = "대상 상태. 이동 경로는 화면이 이 값들로 계산한다(서버가 경로를 주지 않는다)")
    public record State(
            UUID curriculumId,
            UUID sectionId,
            UUID lessonId,
            UUID liveSessionId,
            UUID enrollmentId,
            UUID studentId,
            String liveSessionStatus,
            OffsetDateTime scheduledAt,
            String replayStatus
    ) {
    }

    public static NotificationTargetResponse from(NotificationTargetResolution resolution) {
        return switch (resolution) {
            case NotificationTargetResolution.Available a -> new NotificationTargetResponse(
                    "AVAILABLE",
                    new State(a.state().curriculumId(), a.state().sectionId(), a.state().lessonId(),
                            a.state().liveSessionId(), a.state().enrollmentId(), a.state().studentId(),
                            a.state().liveSessionStatus(), a.state().scheduledAt(), a.state().replayStatus()),
                    null);
            case NotificationTargetResolution.Gone g ->
                    new NotificationTargetResponse("GONE", null, g.reasonCode());
        };
    }
}
