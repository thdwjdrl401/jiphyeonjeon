package com.liveclass.learning.repository;

import com.liveclass.learning.domain.Bookmark;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface BookmarkRepository extends JpaRepository<Bookmark, UUID> {

    /** 레슨 학습 컨텍스트에 실을 내 북마크(오래된 순). */
    List<Bookmark> findByUserIdAndLessonIdOrderBySessionMsAsc(UUID userId, UUID lessonId);

    /** 멱등 추가의 사전 확인 — 같은 위치 북마크가 이미 있는지. */
    Optional<Bookmark> findByUserIdAndLessonIdAndSessionMs(UUID userId, UUID lessonId, long sessionMs);
}
