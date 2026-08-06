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

    /**
     * 멱등 삭제. user·lesson으로 함께 걸러 남의 북마크를 지우거나 다른 레슨의 id가 섞여 들어오는
     * 것을 막는다 — 이미 없거나 남의 것이면 0행으로 조용히 끝난다(존재를 드러내지 않는다).
     */
    long deleteByIdAndUserIdAndLessonId(UUID id, UUID userId, UUID lessonId);
}
