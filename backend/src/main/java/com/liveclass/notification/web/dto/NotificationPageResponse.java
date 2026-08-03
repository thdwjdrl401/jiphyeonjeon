package com.liveclass.notification.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;

import java.util.List;

/**
 * 목록 한 쪽. <b>개수는 필터와 무관한 전체 기준</b>이다 — {@code readState=UNREAD}로 걸러도
 * {@code unreadCount}는 전체 미읽음 수다. 목록과 같은 응답에 담아야 "모두 읽음" 직후 목록은
 * 비었는데 배지만 남는 어긋남이 생기지 않는다.
 */
@Schema(description = "알림 목록 한 쪽")
public record NotificationPageResponse(
        List<NotificationResponse> items,
        int page,
        int size,
        long totalElements,
        int totalPages,
        boolean hasNext,
        long unreadCount,
        long actionRequiredCount
) {
}
