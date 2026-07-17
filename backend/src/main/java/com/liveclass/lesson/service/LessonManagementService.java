package com.liveclass.lesson.service;

import com.liveclass.lesson.api.LessonManagement;
import com.liveclass.lesson.api.LessonView;
import com.liveclass.lesson.domain.Lesson;
import com.liveclass.lesson.domain.LessonStatus;
import com.liveclass.lesson.repository.LessonRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * LessonManagement 구현. 데이터 조작만 담당하고 소유권 검증은 하지 않는다(호출자 책임).
 * curriculum.lesson_count/published_lesson_count는 DB 트리거(trg_lesson_count)가 유지한다 — 앱은 안 건드린다.
 */
@Service
public class LessonManagementService implements LessonManagement {

    private final LessonRepository lessonRepository;

    public LessonManagementService(LessonRepository lessonRepository) {
        this.lessonRepository = lessonRepository;
    }

    @Override
    @Transactional
    public LessonView create(UUID sectionId, String title, String description) {
        Lesson lesson = new Lesson();
        lesson.setSectionId(sectionId);
        lesson.setTitle(title);
        lesson.setDescription(description);
        lesson.setStatus(LessonStatus.DRAFT);
        // 새 레슨은 맨 뒤. UNIQUE(section_id, order_index) 충돌을 피해 마지막+1.
        lesson.setOrderIndex(nextOrder(sectionId));
        return toView(lessonRepository.save(lesson));
    }

    @Override
    @Transactional
    public LessonView update(UUID lessonId, String title, String description) {
        Lesson lesson = lessonRepository.findById(lessonId)
                .orElseThrow(() -> new IllegalStateException("레슨이 없습니다: " + lessonId));
        if (title != null) {
            lesson.setTitle(title);
        }
        if (description != null) {
            lesson.setDescription(description);
        }
        return toView(lesson);
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<LessonView> findById(UUID lessonId) {
        return lessonRepository.findById(lessonId).map(this::toView);
    }

    @Override
    @Transactional(readOnly = true)
    public List<LessonView> findBySection(UUID sectionId) {
        return lessonRepository.findBySectionIdOrderByOrderIndexAsc(sectionId).stream()
                .map(this::toView)
                .toList();
    }

    @Override
    @Transactional
    public void delete(UUID lessonId) {
        lessonRepository.deleteById(lessonId);
    }

    private int nextOrder(UUID sectionId) {
        return lessonRepository.findTopBySectionIdOrderByOrderIndexDesc(sectionId)
                .map(last -> last.getOrderIndex() + 1)
                .orElse(0);
    }

    private LessonView toView(Lesson lesson) {
        return new LessonView(
                lesson.getId(),
                lesson.getSectionId(),
                lesson.getTitle(),
                lesson.getDescription(),
                lesson.getOrderIndex(),
                lesson.getStatus().name(),
                lesson.getCreatedAt(),
                lesson.getUpdatedAt());
    }
}
