package com.liveclass.notification.api;

import java.util.Map;

import static com.liveclass.notification.domain.NotificationStatus.ERROR;
import static com.liveclass.notification.domain.NotificationStatus.HIGH;
import static com.liveclass.notification.domain.NotificationStatus.NORMAL;

/**
 * 알림 종류와 그 중요도(CONTRACT §2-4).
 *
 * <p><b>중요도의 기준은 "지나면 늦는가"다.</b> 실패는 사용자가 대응해야 하므로 ERROR, 라이브 시각에
 * 걸린 것은 때를 놓치면 의미가 없어지므로 HIGH, 나머지는 언제 봐도 유효한 소식이라 NORMAL이다.
 *
 * <p>이 매핑은 FE 목(<code>mockNotificationStore.ts</code>)이 먼저 갖고 있었다. <b>정본을 여기로
 * 옮긴다</b> — 값을 내려주는 쪽이 서버이기 때문이다.
 */
public final class NotificationTypes {

    private NotificationTypes() {
    }

    public static final String ENROLLMENT_REQUESTED = "ENROLLMENT_REQUESTED";
    public static final String ENROLLMENT_APPROVED = "ENROLLMENT_APPROVED";
    public static final String ENROLLMENT_REJECTED = "ENROLLMENT_REJECTED";
    public static final String LIVE_SCHEDULED = "LIVE_SCHEDULED";
    public static final String LIVE_STARTING_SOON = "LIVE_STARTING_SOON";
    public static final String LIVE_SCHEDULE_CHANGED = "LIVE_SCHEDULE_CHANGED";
    public static final String LIVE_CANCELED = "LIVE_CANCELED";
    public static final String LESSON_PUBLISHED = "LESSON_PUBLISHED";
    public static final String MATERIAL_PUBLISHED = "MATERIAL_PUBLISHED";
    public static final String RECORDING_READY = "RECORDING_READY";
    public static final String RECORDING_FAILED = "RECORDING_FAILED";
    public static final String VOD_PUBLISHED = "VOD_PUBLISHED";

    private static final Map<String, String> SEVERITY = Map.ofEntries(
            Map.entry(ENROLLMENT_REQUESTED, NORMAL),
            Map.entry(ENROLLMENT_APPROVED, NORMAL),
            Map.entry(ENROLLMENT_REJECTED, NORMAL),
            Map.entry(LIVE_SCHEDULED, NORMAL),
            Map.entry(LIVE_STARTING_SOON, HIGH),
            Map.entry(LIVE_SCHEDULE_CHANGED, HIGH),
            Map.entry(LIVE_CANCELED, HIGH),
            Map.entry(LESSON_PUBLISHED, NORMAL),
            Map.entry(MATERIAL_PUBLISHED, NORMAL),
            Map.entry(RECORDING_READY, NORMAL),
            Map.entry(RECORDING_FAILED, ERROR),
            Map.entry(VOD_PUBLISHED, NORMAL));

    /** 알 수 없는 종류는 NORMAL로 둔다 — 색을 못 정한다고 알림을 막을 이유가 없다. */
    public static String severityOf(String type) {
        return SEVERITY.getOrDefault(type, NORMAL);
    }

    public static boolean isKnown(String type) {
        return SEVERITY.containsKey(type);
    }
}
