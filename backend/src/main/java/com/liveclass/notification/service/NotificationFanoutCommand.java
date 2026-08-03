package com.liveclass.notification.service;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * 큐를 지나가는 메시지. <b>수신자 명단이 아니라 "무슨 사건인가 + 어디까지 왔나"만 담는다</b>
 * (ADR-0073 §5).
 *
 * <p>명단을 담으면 수신자가 100만 명일 때 uuid 100만 개가 앱 메모리와 큐를 지나간다. 사건만 담으면
 * <b>크기가 수신자 수와 무관하게 일정하다</b>. 누구에게 갈지는 워커가 {@code type}으로 고르는
 * <b>미리 정의된 규칙</b>이 정한다 — 메시지가 조건문을 실어 나르면 주입 표면이 생기고, 조건을
 * 고쳤을 때 큐에 떠 있는 옛 메시지가 옛 조건으로 돈다.
 *
 * <p>커리큘럼 제목·자료 이름이 실려 있는 것은 <b>의도된 것</b>이다. 알림은 그때 일어난 일의
 * 기록이라 나중에 이름이 바뀌어도 그때 이름으로 남는 편이 맞고, 워커가 다른 모듈을 조회하지
 * 않아도 된다.
 *
 * <p><b>필드를 더해도 옛 메시지가 깨지지 않는다.</b> 없는 값은 null로 들어오고, 좁은 팬아웃은
 * 커서 두 칸을 쓰지 않는다.
 *
 * @param occurredAt  사건 시각. 중복 제거 키에 들어간다 — 재신청·재결정이 같은 행을 되살리므로
 *                    이 값이 없으면 두 번째 사건이 첫 번째 알림에 묻힌다.
 * @param afterUserId 넓은 팬아웃의 커서. 조건으로 걸러진 집합 안에서의 위치이지 전체 순번이 아니다.
 *                    첫 조각은 null이고, 워커가 <b>자기 다음 조각</b>을 큐에 넣으며 채운다.
 * @param sliceLimit  한 조각 크기. 메시지가 들고 다니는 이유는 조각을 이어받는 쪽이 같은 크기로
 *                    계속 잘라야 커서 해석이 일관되기 때문이다.
 */
public record NotificationFanoutCommand(
        String type,
        UUID enrollmentId,
        UUID curriculumId,
        String curriculumTitle,
        UUID instructorId,
        UUID studentId,
        UUID lessonId,
        UUID materialId,
        /** 자료 파일명처럼 문구에 들어갈 대상 이름. */
        String subjectName,
        OffsetDateTime occurredAt,
        UUID afterUserId,
        Integer sliceLimit,
        UUID liveSessionId,
        /** 일정 변경의 "언제에서". 변경 알림에만 값이 있다. */
        OffsetDateTime previousStartsAt,
        /** 예정·변경의 새 시각. 취소에는 없다. */
        OffsetDateTime nextStartsAt
) {

    /** 좁은 팬아웃(수신자가 정해진 사건). 커서 두 칸은 쓰지 않는다. */
    static NotificationFanoutCommand forEnrollment(String type, UUID enrollmentId, UUID curriculumId,
                                                   String curriculumTitle, UUID instructorId,
                                                   UUID studentId, OffsetDateTime occurredAt) {
        return new NotificationFanoutCommand(type, enrollmentId, curriculumId, curriculumTitle,
                instructorId, studentId, null, null, null, occurredAt, null, null, null, null, null);
    }

    /** 넓은 팬아웃의 <b>첫</b> 조각. 커서는 비어 있고 워커가 이어 간다. */
    static NotificationFanoutCommand forCurriculumMaterial(UUID curriculumId, String curriculumTitle,
                                                           UUID lessonId, UUID materialId,
                                                           String fileName, OffsetDateTime occurredAt,
                                                           int sliceLimit) {
        return new NotificationFanoutCommand(
                com.liveclass.notification.api.NotificationTypes.MATERIAL_PUBLISHED,
                null, curriculumId, curriculumTitle, null, null,
                lessonId, materialId, fileName, occurredAt, null, sliceLimit, null, null, null);
    }

    /**
     * 라이브 일정 알림의 <b>첫</b> 조각. 강의 제목({@code subjectName})은 워커가 채운다 — 라이브
     * 세션은 제목을 갖지 않고 레슨이 갖는데, 그것을 발행 시점에 조회하면 업무 트랜잭션이 길어진다.
     */
    static NotificationFanoutCommand forLiveSchedule(String type, UUID curriculumId, UUID lessonId,
                                                     UUID liveSessionId, OffsetDateTime previousStartsAt,
                                                     OffsetDateTime nextStartsAt, OffsetDateTime occurredAt,
                                                     int sliceLimit) {
        return new NotificationFanoutCommand(type, null, curriculumId, null, null, null,
                lessonId, null, null, occurredAt, null, sliceLimit,
                liveSessionId, previousStartsAt, nextStartsAt);
    }

    /** 다음 조각. 사건은 그대로 두고 커서만 옮긴다. */
    NotificationFanoutCommand nextSlice(UUID lastUserId) {
        return new NotificationFanoutCommand(type, enrollmentId, curriculumId, curriculumTitle,
                instructorId, studentId, lessonId, materialId, subjectName, occurredAt,
                lastUserId, sliceLimit, liveSessionId, previousStartsAt, nextStartsAt);
    }
}
