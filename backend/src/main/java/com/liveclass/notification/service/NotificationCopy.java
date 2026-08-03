package com.liveclass.notification.service;

import com.liveclass.notification.api.NotificationTypes;

/**
 * 알림 문구. <b>만들 때 완성해 저장한다</b>(ADR-0073 §7) — 알림은 "지금 상태"가 아니라 그때 일어난
 * 일의 기록이고, 무엇보다 목록 조회가 단일 테이블 읽기가 된다(화면이 60초마다 개수를 물어본다).
 *
 * <p>다국어 계획이 없으므로 문장을 그대로 굳힌다. 필요해지면 그때 params 컬럼을 더하면 되고,
 * 그 이전 알림이 한국어로 남는 것은 감수한다(ADR-0073 §채택하지 않은 대안 3).
 */
final class NotificationCopy {

    private NotificationCopy() {
    }

    static String title(String type) {
        return switch (type) {
            case NotificationTypes.ENROLLMENT_REQUESTED -> "새 수강 신청";
            case NotificationTypes.ENROLLMENT_APPROVED -> "수강 신청이 승인되었습니다";
            case NotificationTypes.ENROLLMENT_REJECTED -> "수강 신청이 거절되었습니다";
            case NotificationTypes.MATERIAL_PUBLISHED -> "새 강의 자료";
            default -> throw new IllegalArgumentException("문구가 정의되지 않은 알림 종류입니다: " + type);
        };
    }

    /**
     * @param subject 문구에 들어갈 대상 이름. 수강 알림에서는 <b>신청한 학생</b>, 자료 알림에서는
     *                <b>자료 파일명</b>이다 — 자리는 같고 의미가 다르다.
     *
     *                <p>학생 이름은 강사에게 가는 알림에만 실린다(본인에게 자기 이름을 되돌려 줄
     *                이유가 없다). {@code null}이면 이름 없는 문장으로 떨어진다 — 이름을 못 찾았다고
     *                알림을 통째로 거르는 것보다 낫다.
     */
    static String message(String type, String curriculumTitle, String subject) {
        return switch (type) {
            case NotificationTypes.ENROLLMENT_REQUESTED -> subject == null
                    ? "«%s» 수강 신청이 들어왔습니다. 승인 또는 거절해 주세요.".formatted(curriculumTitle)
                    : "%s 님이 «%s» 수강을 신청했습니다. 승인 또는 거절해 주세요."
                            .formatted(subject, curriculumTitle);
            case NotificationTypes.ENROLLMENT_APPROVED ->
                    "«%s» 수강이 승인되었습니다. 지금부터 강의를 들을 수 있습니다.".formatted(curriculumTitle);
            case NotificationTypes.ENROLLMENT_REJECTED ->
                    "«%s» 수강 신청이 거절되었습니다.".formatted(curriculumTitle);
            case NotificationTypes.MATERIAL_PUBLISHED -> subject == null || subject.isBlank()
                    ? "«%s»에 새 자료가 올라왔습니다.".formatted(curriculumTitle)
                    : "«%s»에 새 자료 «%s»가 올라왔습니다.".formatted(curriculumTitle, subject);
            default -> throw new IllegalArgumentException("문구가 정의되지 않은 알림 종류입니다: " + type);
        };
    }
}
