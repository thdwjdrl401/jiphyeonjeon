package com.liveclass.curriculum.service;

import com.liveclass.auth.api.UserContact;
import com.liveclass.enrollment.api.EnrollmentView;

/**
 * 수강 기록 + 신청자 신원(PII) 결합 결과. 강사용 목록(대기·로스터) 오케스트레이션의 중간 산물.
 * {@code contact}는 사용자 레코드가 없으면 null일 수 있다.
 */
public record EnrollmentApplicant(
        EnrollmentView enrollment,
        UserContact contact
) {
}
