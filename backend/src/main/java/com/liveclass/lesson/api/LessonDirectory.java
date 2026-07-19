package com.liveclass.lesson.api;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

/**
 * 레슨 조회 포트. 다른 모듈은 이 인터페이스로만 레슨 정보를 얻고, lesson의 엔티티·리포지토리에는
 * 접근하지 않는다(모듈 경계, AGENTS.md).
 */
public interface LessonDirectory {

    /** 섹션에 속한 레슨 수. 빈 섹션 판정 등에 쓴다. */
    long countInSection(UUID sectionId);

    /** 여러 섹션의 PUBLISHED 레슨을 순서대로(한 번에) 반환한다 — 공개 목차용. */
    List<LessonOutlineView> findPublishedBySections(Collection<UUID> sectionIds);
}
