package com.liveclass.live.repository;

import com.liveclass.live.domain.LiveSession;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface LiveSessionRepository extends JpaRepository<LiveSession, UUID> {

    boolean existsByLessonId(UUID lessonId);

    Optional<LiveSession> findByLessonId(UUID lessonId);

    List<LiveSession> findByLessonIdIn(Collection<UUID> lessonIds);
}
