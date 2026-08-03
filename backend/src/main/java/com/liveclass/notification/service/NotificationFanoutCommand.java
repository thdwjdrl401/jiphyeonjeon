package com.liveclass.notification.service;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * 큐를 지나가는 메시지. <b>수신자 명단이 아니라 "무슨 사건인가"만 담는다</b>(ADR-0073 §5).
 *
 * <p>명단을 담으면 수신자가 100만 명일 때 uuid 100만 개가 앱 메모리와 큐를 지나간다. 사건만 담으면
 * 크기가 수신자 수와 무관하게 일정하고, 누구에게 갈지는 워커가 <b>미리 정의된 규칙</b>으로 정한다.
 * 조건을 메시지가 실어 나르면 주입 표면이 생기고, 조건을 고쳤을 때 큐에 떠 있는 옛 메시지가 옛
 * 조건으로 돈다.
 *
 * <p>커리큘럼 제목이 실려 있는 것은 <b>의도된 것</b>이다. 알림은 그때 일어난 일의 기록이라 제목이
 * 나중에 바뀌어도 그때 제목으로 남는 편이 맞고, 워커가 커리큘럼 모듈을 조회하지 않아도 된다.
 *
 * @param occurredAt 사건 시각. 중복 제거 키에 들어간다 — 재신청·재결정이 같은 수강 행을 되살리므로
 *                   이 값이 없으면 두 번째 사건이 첫 번째 알림에 묻힌다.
 */
public record NotificationFanoutCommand(
        String type,
        UUID enrollmentId,
        UUID curriculumId,
        String curriculumTitle,
        UUID instructorId,
        UUID studentId,
        OffsetDateTime occurredAt
) {
}
