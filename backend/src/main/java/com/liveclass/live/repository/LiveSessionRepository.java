package com.liveclass.live.repository;

import com.liveclass.live.domain.LiveSession;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface LiveSessionRepository extends JpaRepository<LiveSession, UUID> {

    boolean existsByLessonId(UUID lessonId);
}
