package com.liveclass.video.repository;

import com.liveclass.video.domain.VideoAsset;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface VideoAssetRepository extends JpaRepository<VideoAsset, UUID> {

    Optional<VideoAsset> findByLiveSessionId(UUID liveSessionId);

    /** egress 완료 webhook은 egressId로 자산을 찾는다(세션 id가 아니라). */
    Optional<VideoAsset> findByEgressId(String egressId);

    boolean existsByLiveSessionId(UUID liveSessionId);

    List<VideoAsset> findByLessonIdIn(Collection<UUID> lessonIds);
}
