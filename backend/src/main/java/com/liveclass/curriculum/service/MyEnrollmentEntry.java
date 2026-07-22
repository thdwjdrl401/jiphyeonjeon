package com.liveclass.curriculum.service;

import com.liveclass.enrollment.api.EnrollmentView;

/**
 * 내 수강 목록 한 건 = 수강 기록 + 그 커리큘럼 카드.
 *
 * <p>수강 기록만으로는 화면(제목·썸네일·강사)을 못 그리는데, 목록을 받은 뒤 커리큘럼을 건건이
 * 조회하면 N+1이라 서버가 한 번에 붙여서 준다.
 */
public record MyEnrollmentEntry(
        EnrollmentView enrollment,
        CatalogCard curriculum
) {
}
