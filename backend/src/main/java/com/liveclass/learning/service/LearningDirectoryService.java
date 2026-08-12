package com.liveclass.learning.service;

import com.liveclass.learning.api.LearningDirectory;
import com.liveclass.learning.api.LearningProgressView;
import com.liveclass.learning.api.RecentWatcherView;
import com.liveclass.learning.domain.LearningProgress;
import com.liveclass.learning.repository.LearningProgressRepository;
import com.liveclass.learning.repository.WatchBucketRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.Collection;
import java.util.List;
import java.util.UUID;

/** LearningDirectory 구현 — 내부 엔티티를 경계 DTO로 변환한다. curriculum이 카탈로그 progress에 쓴다. */
@Service
public class LearningDirectoryService implements LearningDirectory {

    private final LearningProgressRepository progressRepository;
    private final WatchBucketRepository watchBucketRepository;

    public LearningDirectoryService(LearningProgressRepository progressRepository,
                                    WatchBucketRepository watchBucketRepository) {
        this.progressRepository = progressRepository;
        this.watchBucketRepository = watchBucketRepository;
    }

    @Override
    @Transactional(readOnly = true)
    public List<LearningProgressView> findProgress(UUID userId, Collection<UUID> lessonIds) {
        if (lessonIds.isEmpty()) {
            return List.of();
        }
        return progressRepository.findByUserIdAndLessonIdIn(userId, lessonIds).stream()
                .map(this::toView)
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public List<RecentWatcherView> findRecentWatchers(UUID lessonId, OffsetDateTime since) {
        return watchBucketRepository.findRecentWatchers(lessonId, since).stream()
                .map(w -> new RecentWatcherView(
                        w.getUserId(),
                        w.getLastPositionMs(),
                        w.getProgressPercent(),
                        // 순간은 그대로다 — 다른 응답과 같은 존으로 맞춰 화면이 같은 시각으로 읽게 한다.
                        OffsetDateTime.ofInstant(w.getLastReportedAt(), ZoneId.systemDefault())))
                .toList();
    }

    private LearningProgressView toView(LearningProgress p) {
        return new LearningProgressView(
                p.getLessonId(),
                p.getLastPositionMs(),
                p.getProgressPercent() == null ? 0 : p.getProgressPercent(),
                p.getCompletedAt(),
                p.getUpdatedAt());
    }
}
