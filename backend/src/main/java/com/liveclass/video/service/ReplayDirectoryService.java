package com.liveclass.video.service;

import com.liveclass.video.api.ReplayDirectory;
import com.liveclass.video.api.ReplayView;
import com.liveclass.video.domain.VideoAsset;
import com.liveclass.video.repository.VideoAssetRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

/**
 * 다시보기 조회 포트 구현. 녹화 생명주기({@link RecordingService})와 분리해 읽기만 담당한다
 * (lesson 모듈의 Directory/Management 분리와 같은 방향).
 */
@Service
public class ReplayDirectoryService implements ReplayDirectory {

    private final VideoAssetRepository videoAssetRepository;

    public ReplayDirectoryService(VideoAssetRepository videoAssetRepository) {
        this.videoAssetRepository = videoAssetRepository;
    }

    @Override
    @Transactional(readOnly = true)
    public List<ReplayView> findByLessons(Collection<UUID> lessonIds) {
        if (lessonIds.isEmpty()) {
            return List.of();   // 빈 IN 절로 쿼리를 쏘지 않는다.
        }
        return videoAssetRepository.findByLessonIdIn(lessonIds).stream().map(ReplayDirectoryService::toView).toList();
    }

    private static ReplayView toView(VideoAsset asset) {
        return new ReplayView(
                asset.getLessonId(),
                asset.getLiveSessionId(),
                asset.getReplayStatus() == null ? null : asset.getReplayStatus().name(),
                asset.getDurationMs());
    }
}
