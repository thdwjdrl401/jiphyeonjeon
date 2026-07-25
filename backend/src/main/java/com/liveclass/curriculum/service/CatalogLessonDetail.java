package com.liveclass.curriculum.service;

import com.liveclass.lesson.api.MaterialView;

import java.util.List;
import java.util.UUID;

/**
 * 레슨 상세 한 건. 목차(CatalogOutlineLesson)와 달리 설명을 싣고, 어느 커리큘럼·섹션에 속하는지도
 * 함께 준다 — FE가 레슨 화면에서 상위 경로를 다시 조회하지 않아도 되도록.
 *
 * <p>접근 판정을 통과한 뒤에만 만들어지므로 access 필드는 두지 않는다. 열 수 없으면 응답 자체가 없다.
 * materials는 이 레슨의 활성(ACTIVE) 자료다(ADR-0034).
 */
public record CatalogLessonDetail(

        UUID lessonId,
        UUID sectionId,
        UUID curriculumId,
        String sectionTitle,
        String curriculumTitle,
        String title,
        String description,
        int order,
        String status,
        List<MaterialView> materials
) {
}
