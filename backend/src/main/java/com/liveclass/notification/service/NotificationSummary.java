package com.liveclass.notification.service;

/** 배지 두 숫자. 필터와 무관한 전체 기준이다. */
public record NotificationSummary(long unreadCount, long actionRequiredCount) {
}
