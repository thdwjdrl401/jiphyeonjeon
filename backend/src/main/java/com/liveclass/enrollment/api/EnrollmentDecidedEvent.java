package com.liveclass.enrollment.api;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * 강사가 수강 신청을 승인하거나 거절했다. 학생이 결과를 기다리고 있던 순간이다.
 *
 * <p>승인과 거절을 한 사건으로 묶은 이유는 <b>같은 자리에서 같은 조건으로</b> 일어나기 때문이다 —
 * 둘 다 PENDING에서만 가능하고, 받는 사람도 문구 자리도 같다. 나뉘어 있으면 리스너가 두 벌이 된다.
 *
 * <p>제적(REVOKE)은 여기에 없다. 학생이 기다리던 결과가 아니라 이미 수강 중이던 관계를 끊는
 * 일이라 문구도 처리 축도 다르다 — 필요해지면 별도 사건으로 낸다.
 *
 * @param approved   true면 승인, false면 거절
 * @param occurredAt 결정 시각. 거절 뒤 재신청·재결정이 같은 수강 행을 되살리므로, 이 값이 없으면
 *                   두 번째 결정이 첫 번째 알림에 묻힌다 — 중복 제거 키의 일부다.
 */
public record EnrollmentDecidedEvent(
        UUID enrollmentId,
        UUID curriculumId,
        String curriculumTitle,
        UUID instructorId,
        UUID studentId,
        boolean approved,
        OffsetDateTime occurredAt
) {
}
