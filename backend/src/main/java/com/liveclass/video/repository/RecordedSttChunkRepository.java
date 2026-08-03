package com.liveclass.video.repository;

import com.liveclass.video.domain.RecordedSttChunk;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface RecordedSttChunkRepository extends JpaRepository<RecordedSttChunk, Long> {
    Optional<RecordedSttChunk> findByJobIdAndChunkIndex(UUID jobId, int chunkIndex);
    List<RecordedSttChunk> findByJobIdOrderByChunkIndex(UUID jobId);
    long countByJobId(UUID jobId);
}
