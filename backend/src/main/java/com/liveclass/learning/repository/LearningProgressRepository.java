package com.liveclass.learning.repository;

import com.liveclass.learning.domain.LearningProgress;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface LearningProgressRepository extends JpaRepository<LearningProgress, Long> {

    /** upsert의 기준 — 사용자·레슨당 진도 한 행(uq_learning_progress(user_id, lesson_id)). */
    Optional<LearningProgress> findByUserIdAndLessonId(UUID userId, UUID lessonId);

    /** 카탈로그 progress 집계용 배치 조회(N+1 방지). */
    List<LearningProgress> findByUserIdAndLessonIdIn(UUID userId, Collection<UUID> lessonIds);
}
