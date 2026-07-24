package com.liveclass.lesson.api;

import java.util.UUID;

/**
 * 레슨 한 건의 상세를 다른 모듈에 넘기는 경계 DTO.
 *
 * <p>목차용 {@link LessonOutlineView}와 달리 설명(description)까지 싣는다 — 레슨 상세 화면이
 * 필요로 하는 유일한 추가 필드다. 목차 응답에 설명을 얹으면 레슨 수만큼 본문이 불어나므로
 * 단건 조회에서만 준다.
 */
public record LessonDetailView(

        UUID lessonId,
        UUID sectionId,
        String title,
        String description,
        int order,
        String status
) {
}
