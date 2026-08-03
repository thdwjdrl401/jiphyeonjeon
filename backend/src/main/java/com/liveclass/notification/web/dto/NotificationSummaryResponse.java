package com.liveclass.notification.web.dto;

import com.liveclass.notification.service.NotificationSummary;
import io.swagger.v3.oas.annotations.media.Schema;

/** 종에 붙는 두 숫자. 화면이 60초마다 물어본다. */
@Schema(description = "알림 배지 개수")
public record NotificationSummaryResponse(long unreadCount, long actionRequiredCount) {

    public static NotificationSummaryResponse from(NotificationSummary summary) {
        return new NotificationSummaryResponse(summary.unreadCount(), summary.actionRequiredCount());
    }
}
