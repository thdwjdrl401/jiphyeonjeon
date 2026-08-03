package com.liveclass.notification.web.dto;

import com.liveclass.notification.domain.Notification;
import io.swagger.v3.oas.annotations.media.Schema;

import java.time.OffsetDateTime;

/**
 * 알림 한 건(CONTRACT §2-4).
 *
 * <p><b>{@code dedupeKey}는 담지 않는다</b> — 중복을 접기 위한 내부 값이다.
 * <b>라우트 URL도 담지 않는다</b> — 목적지는 {@code type} + {@code targets} + 클릭 시점의 리소스
 * 상태로 화면이 계산한다. 응답에 {@code link}·{@code url}·{@code screen}이 들어오면 계약 위반이다.
 */
@Schema(description = "알림 한 건")
public record NotificationResponse(
        String notificationId,
        String recipientId,
        String type,
        String readStatus,
        String actionStatus,
        String severity,
        String title,
        String message,
        /** 리소스 id 묶음. 서버가 해석하지 않고 저장한 그대로 내려보낸다. */
        Object targets,
        String groupKey,
        OffsetDateTime createdAt,
        OffsetDateTime readAt,
        OffsetDateTime completedAt,
        /** 일정 변경 알림만 값이 있다. "언제에서 언제로"가 없으면 그 알림은 쓸모가 없다. */
        ScheduleChange scheduleChange
) {

    @Schema(description = "일정 변경 전·후")
    public record ScheduleChange(OffsetDateTime previousStartsAt, OffsetDateTime nextStartsAt) {
    }

    public static NotificationResponse from(Notification n, Object targets) {
        ScheduleChange change = n.getPreviousStartsAt() == null && n.getNextStartsAt() == null
                ? null
                : new ScheduleChange(n.getPreviousStartsAt(), n.getNextStartsAt());
        return new NotificationResponse(
                n.getId().toString(),
                n.getRecipientId().toString(),
                n.getType(),
                n.getReadStatus(),
                n.getActionStatus(),
                n.getSeverity(),
                n.getTitle(),
                n.getMessage(),
                targets,
                n.getGroupKey(),
                n.getCreatedAt(),
                n.getReadAt(),
                n.getCompletedAt(),
                change);
    }
}
