package com.liveclass.notification.service;

import com.liveclass.notification.api.NotificationTypes;

import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Locale;

/**
 * 알림 문구. <b>만들 때 완성해 저장한다</b>(ADR-0073 §7) — 알림은 "지금 상태"가 아니라 그때 일어난
 * 일의 기록이고, 무엇보다 목록 조회가 단일 테이블 읽기가 된다(화면이 60초마다 개수를 물어본다).
 *
 * <p>다국어 계획이 없으므로 문장을 그대로 굳힌다. 필요해지면 그때 params 컬럼을 더하면 되고,
 * 그 이전 알림이 한국어로 남는 것은 감수한다(ADR-0073 §채택하지 않은 대안 3).
 */
final class NotificationCopy {

    /**
     * 시각은 <b>한국 시간으로 굳혀서</b> 문장에 넣는다. 저장된 문구는 나중에 다시 만들 수 없으므로
     * 보는 사람의 시간대에 맞출 방법이 없고, 지금 사용자는 전부 한국에 있다. 시간대가 필요해지면
     * 그때는 문구가 아니라 값을 저장해야 한다(§채택하지 않은 대안 3과 같은 갈림길이다).
     */
    private static final ZoneId DISPLAY_ZONE = ZoneId.of("Asia/Seoul");
    private static final DateTimeFormatter WHEN =
            DateTimeFormatter.ofPattern("M월 d일 HH:mm", Locale.KOREAN);

    private NotificationCopy() {
    }

    static String title(String type) {
        return switch (type) {
            case NotificationTypes.ENROLLMENT_REQUESTED -> "새 수강 신청";
            case NotificationTypes.ENROLLMENT_APPROVED -> "수강 신청이 승인되었습니다";
            case NotificationTypes.ENROLLMENT_REJECTED -> "수강 신청이 거절되었습니다";
            case NotificationTypes.MATERIAL_PUBLISHED -> "새 강의 자료";
            case NotificationTypes.LIVE_SCHEDULED -> "라이브 일정이 잡혔습니다";
            case NotificationTypes.LIVE_SCHEDULE_CHANGED -> "라이브 일정이 변경되었습니다";
            case NotificationTypes.LIVE_CANCELED -> "라이브가 취소되었습니다";
            case NotificationTypes.LIVE_STARTING_SOON -> "라이브가 곧 시작합니다";
            case NotificationTypes.RECORDING_READY -> "녹화가 준비되었습니다";
            case NotificationTypes.RECORDING_FAILED -> "녹화에 실패했습니다";
            case NotificationTypes.VOD_PUBLISHED -> "다시보기가 공개되었습니다";
            default -> throw new IllegalArgumentException("문구가 정의되지 않은 알림 종류입니다: " + type);
        };
    }

    /**
     * 좁은 팬아웃(수강 사건)의 문구.
     *
     * @param studentName 신청한 학생 이름. <b>강사에게 가는 알림에만</b> 쓰인다 — 본인에게 자기 이름을
     *                    되돌려 줄 이유가 없다. {@code null}이면 이름 없는 문장으로 떨어진다. 이름을
     *                    못 찾았다고 알림을 통째로 거르는 것보다 낫다.
     */
    static String message(String type, String curriculumTitle, String studentName) {
        return switch (type) {
            case NotificationTypes.ENROLLMENT_REQUESTED -> studentName == null
                    ? "«%s» 수강 신청이 들어왔습니다. 승인 또는 거절해 주세요.".formatted(curriculumTitle)
                    : "%s 님이 «%s» 수강을 신청했습니다. 승인 또는 거절해 주세요."
                            .formatted(studentName, curriculumTitle);
            case NotificationTypes.ENROLLMENT_APPROVED ->
                    "«%s» 수강이 승인되었습니다. 지금부터 강의를 들을 수 있습니다.".formatted(curriculumTitle);
            case NotificationTypes.ENROLLMENT_REJECTED ->
                    "«%s» 수강 신청이 거절되었습니다.".formatted(curriculumTitle);
            default -> throw new IllegalArgumentException("문구가 정의되지 않은 알림 종류입니다: " + type);
        };
    }

    /**
     * 넓은 팬아웃(커리큘럼 전체에 가는 사건)의 문구.
     *
     * @param subject 자료 알림은 <b>파일명</b>, 라이브 알림은 <b>강의 제목</b>. 자리는 같고 의미가
     *                다르며, 어느 쪽도 없을 수 있다(못 찾았다고 알림을 거르지 않는다).
     */
    static String wideMessage(String type, String curriculumTitle, String subject,
                              OffsetDateTime previousStartsAt, OffsetDateTime nextStartsAt) {
        return switch (type) {
            case NotificationTypes.MATERIAL_PUBLISHED -> blank(subject)
                    ? "«%s»에 새 자료가 올라왔습니다.".formatted(curriculumTitle)
                    : "«%s»에 새 자료 «%s»가 올라왔습니다.".formatted(curriculumTitle, subject);
            case NotificationTypes.LIVE_SCHEDULED ->
                    "%s 라이브가 %s에 열립니다.".formatted(lessonLabel(subject), when(nextStartsAt));
            /*
             * 변경 알림은 "언제에서 언제로"가 없으면 쓸모가 없다. 옛 시각을 못 찾은 경우에도
             * 최소한 새 시각은 알려 준다 — 학생이 옛 시각을 그대로 믿는 것이 가장 나쁘다.
             */
            case NotificationTypes.LIVE_SCHEDULE_CHANGED -> previousStartsAt == null
                    ? "%s 라이브 일정이 %s로 변경되었습니다.".formatted(lessonLabel(subject), when(nextStartsAt))
                    : "%s 라이브가 %s에서 %s로 변경되었습니다."
                            .formatted(lessonLabel(subject), when(previousStartsAt), when(nextStartsAt));
            case NotificationTypes.LIVE_STARTING_SOON ->
                    "%s 라이브가 %s에 시작합니다.".formatted(lessonLabel(subject), when(nextStartsAt));
            case NotificationTypes.VOD_PUBLISHED -> "%s 다시보기가 공개되었습니다. 지금부터 볼 수 있습니다."
                    .formatted(lessonLabel(subject));
            case NotificationTypes.LIVE_CANCELED -> previousStartsAt == null
                    ? "%s 라이브가 취소되었습니다.".formatted(lessonLabel(subject))
                    : "%s에 열릴 예정이던 %s 라이브가 취소되었습니다."
                            .formatted(when(previousStartsAt), lessonLabel(subject));
            default -> throw new IllegalArgumentException("문구가 정의되지 않은 알림 종류입니다: " + type);
        };
    }

    /**
     * 강사에게 가는 녹화 문구.
     *
     * <p>실패 코드를 문장에 넣지 않는다. 강사에게 의미 있는 말은 "녹화가 실패했으니 확인하라"이고,
     * {@code MANIFEST_MISSING} 같은 코드는 우리가 로그에서 볼 값이다.
     */
    static String recordingMessage(String type, String lessonTitle) {
        return switch (type) {
            case NotificationTypes.RECORDING_READY ->
                    "%s 녹화가 준비되었습니다. 확인하고 공개 여부를 정해 주세요.".formatted(lessonLabel(lessonTitle));
            case NotificationTypes.RECORDING_FAILED ->
                    "%s 녹화에 실패했습니다. 다시 진행하지 않으면 이 회차는 다시 볼 수 없습니다."
                            .formatted(lessonLabel(lessonTitle));
            default -> throw new IllegalArgumentException("문구가 정의되지 않은 알림 종류입니다: " + type);
        };
    }

    /** 강의 제목을 못 찾아도 문장이 성립해야 한다. */
    private static String lessonLabel(String subject) {
        return blank(subject) ? "예정된" : "«%s»".formatted(subject);
    }

    private static String when(OffsetDateTime at) {
        return at == null ? "미정" : WHEN.format(at.atZoneSameInstant(DISPLAY_ZONE));
    }

    private static boolean blank(String value) {
        return value == null || value.isBlank();
    }
}
