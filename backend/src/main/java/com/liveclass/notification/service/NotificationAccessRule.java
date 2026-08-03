package com.liveclass.notification.service;

import com.liveclass.notification.api.NotificationTypes;

/**
 * 알림을 눌렀을 때 <b>무엇을 확인해야 그 화면을 볼 수 있는가</b>. 종류마다 다르다.
 *
 * <p>전부 "수강 중이어야 한다"로 두면 <b>거절 알림이 자기 자신 때문에 막힌다</b> — 거절당한 학생은
 * 정의상 수강 중이 아니다. 그러면 "신청이 거절되었습니다"를 눌렀을 때 "더 이상 볼 수 없습니다"가
 * 뜬다. 받는 사람이 볼 자격이 있어서 보낸 알림인데 그 자격을 다시 부정하는 꼴이다.
 */
enum NotificationAccessRule {

    /** 그 커리큘럼의 담당 강사여야 한다. */
    INSTRUCTOR_OWNER,

    /** 수강 중(ACTIVE)이어야 한다. 수강 취소·제적하면 볼 수 없다. */
    ACTIVE_STUDENT,

    /** 카탈로그에 보이기만 하면 된다(PUBLISHED). 수강 관계를 요구하지 않는다. */
    PUBLISHED_CATALOG;

    static NotificationAccessRule of(String type) {
        return switch (type) {
            case NotificationTypes.ENROLLMENT_REQUESTED -> INSTRUCTOR_OWNER;
            /*
             * 거절 알림만 카탈로그 규칙이다. 학생은 그 커리큘럼 소개 화면으로 가고, 정책이 허락하면
             * 거기서 다시 신청할 수 있다 — 알림이 막다른 길이 되지 않는다.
             */
            case NotificationTypes.ENROLLMENT_REJECTED -> PUBLISHED_CATALOG;
            default -> ACTIVE_STUDENT;
        };
    }
}
