package com.liveclass.lesson.service;

import com.liveclass.lesson.api.LessonDetailView;
import com.liveclass.lesson.api.LessonDirectory;
import com.liveclass.lesson.api.LessonOutlineView;
import com.liveclass.lesson.domain.Lesson;
import com.liveclass.lesson.domain.LessonStatus;
import com.liveclass.lesson.repository.LessonRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;

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
    public List<LessonOutlineView> findBySections(Collection<UUID> sectionIds) {
        if (sectionIds.isEmpty()) {
            return List.of();
        }
        return lessonRepository
                .findBySectionIdInOrderByOrderIndexAsc(sectionIds)
                .stream()
                .map(this::toView)
                .toList();
    }

    /** 제목 배치 조회 — findAllById가 IN 쿼리 한 번으로 끝낸다(행마다 findById 금지). */
    @Override
    @Transactional(readOnly = true)
    public Map<UUID, String> findTitles(Collection<UUID> lessonIds) {
        if (lessonIds.isEmpty()) {
            return Map.of();
        }
        return lessonRepository.findAllById(lessonIds).stream()
                .collect(Collectors.toMap(Lesson::getId, Lesson::getTitle));
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<LessonDetailView> findDetail(UUID lessonId) {
        return lessonRepository.findById(lessonId).map(this::toDetailView);
    }

    private LessonDetailView toDetailView(Lesson lesson) {
        return new LessonDetailView(
                lesson.getId(),
                lesson.getSectionId(),
                lesson.getTitle(),
                lesson.getDescription(),
                lesson.getOrderIndex(),
                lesson.getStatus().name());
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
