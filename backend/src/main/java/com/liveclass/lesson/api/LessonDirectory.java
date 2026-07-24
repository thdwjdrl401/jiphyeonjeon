package com.liveclass.lesson.api;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
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

    /**
     * 레슨 ID → 제목을 <b>한 번에</b> 조회한다(N+1 방지). 다른 모듈이 목록 응답에 레슨 제목만
     * 곁들일 때 쓴다(예: 커리큘럼 목록의 다음 라이브 세션). 없는 ID는 맵에 담기지 않는다.
     */
    Map<UUID, String> findTitles(Collection<UUID> lessonIds);

    /**
     * 레슨 한 건을 상태와 무관하게 조회한다. 게시 여부·수강 관계 판정은 호출하는 쪽 몫이다 —
     * 여기서 미게시를 걸러 버리면 소유 강사에게 자기 초안을 보여줄 수 없다.
     */
    Optional<LessonDetailView> findDetail(UUID lessonId);
}
