package com.liveclass.learning.service;

import com.liveclass.learning.api.LearningDirectory;
import com.liveclass.learning.api.LearningProgressView;
import com.liveclass.learning.domain.LearningProgress;
import com.liveclass.learning.repository.LearningProgressRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

/** LearningDirectory 구현 — 내부 엔티티를 경계 DTO로 변환한다. curriculum이 카탈로그 progress에 쓴다. */
@Service
public class LearningDirectoryService implements LearningDirectory {

    private final LearningProgressRepository progressRepository;

    public LearningDirectoryService(LearningProgressRepository progressRepository) {
        this.progressRepository = progressRepository;
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

    private LearningProgressView toView(LearningProgress p) {
        return new LearningProgressView(
                p.getLessonId(),
                p.getLastPositionMs(),
                p.getProgressPercent() == null ? 0 : p.getProgressPercent(),
                p.getCompletedAt(),
                p.getUpdatedAt());
    }
}
