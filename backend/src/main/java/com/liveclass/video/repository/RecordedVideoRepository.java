package com.liveclass.video.repository;

import com.liveclass.video.domain.RecordedVideo;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface RecordedVideoRepository extends JpaRepository<RecordedVideo, UUID> {

    Optional<RecordedVideo> findByLessonId(UUID lessonId);

    List<RecordedVideo> findByLessonIdIn(Collection<UUID> lessonIds);

    Optional<RecordedVideo> findByClientRequestId(UUID clientRequestId);
}
