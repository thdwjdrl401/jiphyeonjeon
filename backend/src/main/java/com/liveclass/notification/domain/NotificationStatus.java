package com.liveclass.notification.domain;

/**
 * 알림의 두 상태축과 중요도. <b>enum이 아니라 상수</b>로 둔 것은 엔티티가 문자열을 그대로 담기
 * 때문이다 — 경계(API·DB)에서 enum을 노출하지 않는 이 저장소의 규칙을 따른다.
 */
public final class NotificationStatus {

    private NotificationStatus() {
    }

    /** 봤는가. */
    public static final String UNREAD = "UNREAD";
    public static final String READ = "READ";

    /** 처리했는가. 읽음과 <b>따로</b> 움직인다. */
    public static final String INFO = "INFO";
    public static final String ACTION_REQUIRED = "ACTION_REQUIRED";
    public static final String COMPLETED = "COMPLETED";
    public static final String EXPIRED = "EXPIRED";

    /** 목록 칩 색. 기준은 "지나면 늦는가"다. */
    public static final String NORMAL = "NORMAL";
    public static final String HIGH = "HIGH";
    public static final String ERROR = "ERROR";
}
