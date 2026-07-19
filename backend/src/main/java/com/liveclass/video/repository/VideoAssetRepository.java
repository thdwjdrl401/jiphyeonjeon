package com.liveclass.video.repository;

import com.liveclass.video.domain.VideoAsset;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface VideoAssetRepository extends JpaRepository<VideoAsset, UUID> {

    Optional<VideoAsset> findByLiveSessionId(UUID liveSessionId);

    boolean existsByLiveSessionId(UUID liveSessionId);
}
