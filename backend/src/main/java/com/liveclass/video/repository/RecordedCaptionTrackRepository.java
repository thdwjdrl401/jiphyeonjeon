package com.liveclass.video.repository;

import com.liveclass.video.domain.RecordedCaptionTrack;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface RecordedCaptionTrackRepository extends JpaRepository<RecordedCaptionTrack, UUID> {
    Optional<RecordedCaptionTrack> findByRecordedVideoId(UUID recordedVideoId);
}
