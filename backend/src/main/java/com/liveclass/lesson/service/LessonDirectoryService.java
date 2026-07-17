package com.liveclass.lesson.service;

import com.liveclass.lesson.api.LessonDirectory;
import com.liveclass.lesson.api.LessonOutlineView;
import com.liveclass.lesson.domain.Lesson;
import com.liveclass.lesson.domain.LessonStatus;
import com.liveclass.lesson.repository.LessonRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

/** LessonDirectory 구현 — lesson 내부 엔티티를 경계 DTO로 변환한다. */
@Service
public class LessonDirectoryService implements LessonDirectory {

    private final LessonRepository lessonRepository;

    public LessonDirectoryService(LessonRepository lessonRepository) {
        this.lessonRepository = lessonRepository;
    }

    @Override
    @Transactional(readOnly = true)
    public long countInSection(UUID sectionId) {
        return lessonRepository.countBySectionId(sectionId);
    }

    @Override
    @Transactional(readOnly = true)
    public List<LessonOutlineView> findPublishedBySections(Collection<UUID> sectionIds) {
        if (sectionIds.isEmpty()) {
            return List.of();
        }
        return lessonRepository
                .findBySectionIdInAndStatusOrderByOrderIndexAsc(sectionIds, LessonStatus.PUBLISHED)
                .stream()
                .map(this::toView)
                .toList();
    }

    private LessonOutlineView toView(Lesson lesson) {
        return new LessonOutlineView(
                lesson.getId(),
                lesson.getSectionId(),
                lesson.getTitle(),
                lesson.getOrderIndex(),
                lesson.getStatus().name());
    }
}
