package com.liveclass.auth.api;

import java.util.List;
import java.util.UUID;

/**
 * 다른 모듈에 공개 가능한 강사 요약. auth 모듈이 소유하며 AppUser·InstructorProfile 엔티티를
 * 밖으로 노출하지 않기 위한 경계 DTO다.
 */
public record InstructorSummaryView(

        UUID instructorId,
        String displayName,
        String bio,
        List<String> expertise
) {
}
