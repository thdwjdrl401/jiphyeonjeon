package com.liveclass.enrollment.api;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * 학생이 <b>승인이 필요한</b> 커리큘럼에 수강을 신청했다. 강사에게 처리할 일이 생긴 순간이다.
 *
 * <p>즉시 수강(IMMEDIATE)에는 이 사건이 없다 — 처리할 일이 없는데 "신청이 들어왔습니다"를 보내면
 * 강사의 처리 대기 목록이 영영 줄지 않는다.
 *
 * <p><b>커리큘럼 제목을 실어 보낸다.</b> 알림은 그때 일어난 일의 기록이라 나중에 제목이 바뀌어도
 * 그때 제목으로 남는 편이 맞고, 무엇보다 듣는 쪽이 커리큘럼 모듈을 조회하지 않아도 된다.
 *
 * @param occurredAt 신청 시각. 재신청이 같은 수강 행을 되살리므로(EnrollmentService.apply)
 *                   이 값이 없으면 두 번째 신청이 첫 번째 알림에 묻힌다 — 중복 제거 키의 일부다.
 */
public record EnrollmentRequestedEvent(
        UUID enrollmentId,
        UUID curriculumId,
        String curriculumTitle,
        UUID instructorId,
        UUID studentId,
        OffsetDateTime occurredAt
) {
}
