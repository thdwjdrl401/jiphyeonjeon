package com.liveclass.video.repository;

import com.liveclass.video.domain.RecordedVideo;
import com.liveclass.video.domain.RecordedPublicationStatus;
import com.liveclass.video.domain.RecordedVideoStatus;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface RecordedVideoRepository extends JpaRepository<RecordedVideo, UUID> {

    Optional<RecordedVideo> findByLessonId(UUID lessonId);

    List<RecordedVideo> findByLessonIdIn(Collection<UUID> lessonIds);

    Optional<RecordedVideo> findByClientRequestId(UUID clientRequestId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select video from RecordedVideo video where video.id = :recordedVideoId")
    Optional<RecordedVideo> findByIdForUpdate(@Param("recordedVideoId") UUID recordedVideoId);

    List<RecordedVideo> findTop100ByPublicationStatusAndStatusOrderByUpdatedAtAsc(
            RecordedPublicationStatus publicationStatus,
            RecordedVideoStatus status);
}
