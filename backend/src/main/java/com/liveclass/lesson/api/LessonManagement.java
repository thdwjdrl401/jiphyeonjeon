package com.liveclass.lesson.api;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * 레슨 데이터 CRUD 포트. 소유권·인가는 호출하는 쪽(curriculum)이 책임지고, 이 포트는 데이터
 * 조작만 한다 — lesson 모듈은 curriculum에 의존하지 않는다(순환 금지).
 */
public interface LessonManagement {

    /** 섹션 맨 뒤에 DRAFT 레슨을 만든다. */
    LessonView create(UUID sectionId, String title, String description);

    /** 넘어온 필드만 부분 수정. */
    LessonView update(UUID lessonId, String title, String description);

    Optional<LessonView> findById(UUID lessonId);

    List<LessonView> findBySection(UUID sectionId);

    void delete(UUID lessonId);
}
