package com.liveclass.curriculum.service;

import java.util.List;
import java.util.UUID;

/**
 * 구조 순서 저장 결과(서비스 계층 표현). 응답 DTO 변환은 컨트롤러가 한다 — 서비스는 web을 참조하지 않는다.
 * order는 기존 API가 이미 노출 중인 0-based order_index 그대로다(LessonView.order·SectionResponse.orderIndex와 동일 규약).
 */
public record StructureOrder(

        int structureVersion,
        List<SectionOrder> sections
) {

    public record SectionOrder(UUID sectionId, int order, List<LessonOrder> lessons) {
    }

    public record LessonOrder(UUID lessonId, int order) {
    }
}
