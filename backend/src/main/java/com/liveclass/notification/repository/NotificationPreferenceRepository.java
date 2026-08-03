package com.liveclass.notification.repository;

import com.liveclass.notification.domain.NotificationPreference;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface NotificationPreferenceRepository extends JpaRepository<NotificationPreference, UUID> {

    Optional<NotificationPreference> findByUserIdAndCurriculumIdAndLessonIdIsNull(
            UUID userId, UUID curriculumId);

    Optional<NotificationPreference> findByUserIdAndLessonId(UUID userId, UUID lessonId);

    /** 내 설정 전부 — 설정 화면이 커리큘럼·강의를 한 번에 그린다. */
    List<NotificationPreference> findByUserIdAndCurriculumId(UUID userId, UUID curriculumId);
}
