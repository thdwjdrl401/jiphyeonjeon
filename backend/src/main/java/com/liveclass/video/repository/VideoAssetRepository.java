package com.liveclass.video.repository;

import com.liveclass.video.domain.VideoAsset;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface VideoAssetRepository extends JpaRepository<VideoAsset, UUID> {

    Optional<VideoAsset> findByLiveSessionId(UUID liveSessionId);

    /**
     * 레슨의 녹화 자산(재생·게시용). live_session은 레슨당 1:1이고 video_asset은 세션당 1:0..1이라
     * 레슨당 최대 하나다. 없으면 재생·게시 대상이 없는 것.
     */
    Optional<VideoAsset> findByLessonId(UUID lessonId);

    /** egress 완료 webhook은 egressId로 자산을 찾는다(세션 id가 아니라). */
    Optional<VideoAsset> findByEgressId(String egressId);

    boolean existsByLiveSessionId(UUID liveSessionId);

    List<VideoAsset> findByLessonIdIn(Collection<UUID> lessonIds);
}
