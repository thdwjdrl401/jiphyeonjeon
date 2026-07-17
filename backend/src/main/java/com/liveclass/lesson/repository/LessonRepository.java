package com.liveclass.lesson.repository;

import com.liveclass.lesson.domain.Lesson;
import com.liveclass.lesson.domain.LessonStatus;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

public interface LessonRepository extends JpaRepository<Lesson, UUID> {

    List<Lesson> findBySectionIdOrderByOrderIndexAsc(UUID sectionId);

    long countBySectionId(UUID sectionId);

    /** 공개 목차용 — 여러 섹션의 특정 상태 레슨을 한 번에 조회(N+1 방지). */
    List<Lesson> findBySectionIdInAndStatusOrderByOrderIndexAsc(Collection<UUID> sectionIds, LessonStatus status);
}
