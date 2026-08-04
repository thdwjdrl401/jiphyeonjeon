package com.liveclass.enrollment.api;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * 학생이 자기 신청·수강을 스스로 물렀다.
 *
 * <p><b>이 사건은 알림을 만들지 않는다.</b> 강사에게 "누가 취소했습니다"를 보내면 할 수 있는 일이
 * 없는 소식만 하나 더 쌓인다. 대신 <b>이미 보낸 알림을 정리</b>하는 데 쓴다 — 강사의 "처리 대기"
 * 목록에 남아 있던 그 신청은 이제 승인할 수도 거절할 수도 없으므로, 대기로 두면 아무리 눌러도
 * 처리되지 않는 항목이 된다.
 *
 * <p>{@link EnrollmentDecidedEvent}와 합치지 않았다. 그쪽은 <b>강사가 처리한</b> 사건이라 완료로
 * 닫히지만, 취소는 <b>처리할 일이 사라진</b> 사건이라 만료로 닫힌다 — 강사가 하지도 않은 일을
 * 했다고 기록하지 않으려면 두 축이 갈라져 있어야 한다.
 *
 * <p><b>승인 대기가 아니었던 취소도 낸다.</b> 수강 중이던 학생의 취소에는 정리할 대기 알림이
 * 없지만, 그 판단을 여기서 하면 수강 로직이 알림의 사정을 알아야 한다(ADR-0073 §1). 정리 대상이
 * 없으면 0행이 갱신될 뿐이다.
 *
 * <p>제적(REVOKE)은 여기 없다. 대기 중인 신청이 아니라 이미 수강 중이던 관계를 끊는 일이라
 * 정리할 대기 알림이 애초에 생기지 않는다.
 *
 * @param occurredAt 취소 시각.
 */
public record EnrollmentCanceledEvent(
        UUID enrollmentId,
        UUID curriculumId,
        UUID studentId,
        OffsetDateTime occurredAt
) {
}
