package com.liveclass.lesson.service;

import com.liveclass.lesson.api.LessonManagement;
import com.liveclass.lesson.api.LessonNotFoundException;
import com.liveclass.lesson.api.LessonPlacement;
import com.liveclass.lesson.api.LessonView;
import com.liveclass.lesson.domain.Lesson;
import com.liveclass.lesson.domain.LessonStatus;
import com.liveclass.lesson.repository.LessonRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;

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
        // 만들어지는 순간 게시 상태다 — 레슨에 초안이 없다(ADR-0005). 외부 공개 여부는
        // 커리큘럼 lifecycleStatus가 결정하므로, 비공개 커리큘럼의 레슨은 여기서 PUBLISHED여도
        // 카탈로그에 노출되지 않는다.
        lesson.setStatus(LessonStatus.PUBLISHED);
        lesson.setPublishedAt(OffsetDateTime.now());
        // 새 레슨은 맨 뒤. UNIQUE(section_id, order_index) 충돌을 피해 마지막+1.
        lesson.setOrderIndex(nextOrder(sectionId));
        return toView(lessonRepository.save(lesson));
    }

    @Override
    @Transactional
    public LessonView update(UUID lessonId, String title, String description) {
        Lesson lesson = lessonRepository.findById(lessonId)
                .orElseThrow(() -> new LessonNotFoundException("레슨이 없습니다: " + lessonId));
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
    @Transactional(readOnly = true)
    public List<LessonView> findBySections(Collection<UUID> sectionIds) {
        if (sectionIds.isEmpty()) {
            return List.of();
        }
        return lessonRepository.findBySectionIdInOrderByOrderIndexAsc(sectionIds).stream()
                .map(this::toView)
                .toList();
    }

    @Override
    @Transactional
    public void delete(UUID lessonId) {
        lessonRepository.deleteById(lessonId);
    }

    /**
     * 소속 섹션·순서를 통째로 다시 쓴다. 한 트랜잭션 안에서만 의미가 있으므로 호출자의 트랜잭션에
     * 참여한다(REQUIRED). DEFERRABLE UNIQUE 덕분에 중간 상태 충돌을 신경 쓰지 않아도 된다.
     */
    @Override
    @Transactional
    public void applyPlacements(List<LessonPlacement> placements) {
        if (placements.isEmpty()) {
            return;
        }
        Map<UUID, Lesson> byId = lessonRepository
                .findAllById(placements.stream().map(LessonPlacement::lessonId).toList())
                .stream()
                .collect(Collectors.toMap(Lesson::getId, lesson -> lesson));

        for (LessonPlacement placement : placements) {
            Lesson lesson = byId.get(placement.lessonId());
            if (lesson == null) {
                throw new LessonNotFoundException("레슨이 없습니다: " + placement.lessonId());
            }
            lesson.setSectionId(placement.sectionId());
            lesson.setOrderIndex(placement.orderIndex());
        }
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
