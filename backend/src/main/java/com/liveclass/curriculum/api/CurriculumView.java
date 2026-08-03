package com.liveclass.curriculum.api;

import java.util.UUID;

/**
 * 커리큘럼의 경계 표현. 다른 모듈이 "이 커리큘럼이 아직 있는가, 누가 주인인가, 카탈로그에
 * 보이는가"를 답하는 데 필요한 만큼만 담는다 — 목차·자료·정책은 각자의 화면이 따로 조회한다.
 */
public record CurriculumView(
        UUID curriculumId,
        UUID instructorId,
        String title,
        /** DRAFT·PUBLISHED·ARCHIVED. PUBLISHED만 카탈로그에 보인다. */
        String lifecycleStatus
) {

    public boolean isPublished() {
        return "PUBLISHED".equals(lifecycleStatus);
    }
}
