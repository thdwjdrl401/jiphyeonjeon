package com.liveclass.video.repository;

import com.liveclass.video.domain.VideoAsset;
import com.liveclass.video.domain.VideoAssetStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

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

    /**
     * 운영 콘솔용 상태 분포. 녹화가 어디서 멈춰 있는지를 한눈에 본다 — 실제로 READY가 <b>한 건도</b>
     * 없이 FINALIZING만 쌓여 있던 적이 있고(LiveKit이 완료 webhook을 보내도록 설정돼 있지 않았다),
     * 그걸 알아채는 데 DB를 직접 들여다봐야 했다.
     */
    @Query("SELECT a.status, COUNT(a), MAX(a.createdAt) FROM VideoAsset a GROUP BY a.status")
    List<Object[]> countByStatus();

    /** 가장 오래 멈춰 있는 자산의 생성 시각(정체 판단용). 없으면 empty. */
    Optional<VideoAsset> findFirstByStatusOrderByCreatedAtAsc(VideoAssetStatus status);

    /** 보정 대상 조회(오래된 것부터). 완료 webhook이 오지 않아 멈춘 자산을 서버에 직접 물어 확정한다. */
    List<VideoAsset> findByStatusOrderByCreatedAtAsc(VideoAssetStatus status);
}
