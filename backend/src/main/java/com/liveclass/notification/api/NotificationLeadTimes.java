package com.liveclass.notification.api;

import java.util.List;

/**
 * 곧 시작 알림의 리드타임 선택지(ADR-0073 §6).
 *
 * <p><b>자유 입력이 아니다.</b> 누가 47분으로 바꿀 때마다 그 세션에 새 예약 행을 만들어야 하고,
 * 설정 변경이 예정 표를 건드리게 된다. 선택지가 고정이면 예약 행이 <b>처음부터 선택지 전부를</b>
 * 갖고 있을 수 있고, 그러면 설정이 바뀌어도 예정 표는 그대로다.
 */
public final class NotificationLeadTimes {

    /** 5분·10분·30분·1시간·3시간·하루 전. DB CHECK 제약과 같은 목록이다. */
    public static final List<Integer> CHOICES = List.of(5, 10, 30, 60, 180, 1440);

    /** 설정하지 않은 사람이 받는 값. */
    public static final int DEFAULT_MINUTES = 10;

    private NotificationLeadTimes() {
    }

    public static boolean isAllowed(Integer minutes) {
        return minutes != null && CHOICES.contains(minutes);
    }
}
