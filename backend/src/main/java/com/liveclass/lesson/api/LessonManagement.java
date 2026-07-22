package com.liveclass.lesson.api;

import java.util.Collection;
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

    /**
     * 여러 섹션의 레슨을 상태 무관하게 한 번에 조회한다(N+1 회피). 구조 순서 저장이 "커리큘럼의
     * 현재 레슨 전체"를 알아야 하므로 필요하다 — 공개 목차용 LessonDirectory와 달리 DRAFT도 포함한다.
     */
    List<LessonView> findBySections(Collection<UUID> sectionIds);

    void delete(UUID lessonId);

    /**
     * 레슨의 소속 섹션·순서를 한 트랜잭션에서 통째로 다시 쓴다(STRUCTURE-01).
     * uq_lesson_order(section_id, order_index)는 DEFERRABLE INITIALLY DEFERRED라 중간 충돌 없이
     * 자유롭게 재배정할 수 있다 — 임시값 셔플이 필요 없다.
     */
    void applyPlacements(List<LessonPlacement> placements);

    /** 레슨을 PUBLISHED로. published_at 세팅. 전이 유효성(중복 발행 등)은 호출자 책임. */
    LessonView publish(UUID lessonId);

    /** 레슨을 DRAFT로 되돌리고 published_at 해제. */
    LessonView unpublish(UUID lessonId);
}
