package com.liveclass.curriculum.service;

import com.liveclass.curriculum.domain.Curriculum;
import com.liveclass.curriculum.domain.Section;
import com.liveclass.curriculum.repository.CurriculumRepository;
import com.liveclass.curriculum.repository.SectionRepository;
import com.liveclass.enrollment.api.EnrollmentDirectory;
import com.liveclass.lesson.api.LessonDetailView;
import com.liveclass.lesson.api.LessonDirectory;
import com.liveclass.video.api.LessonPlaybackAccess;
import com.liveclass.video.api.PlaybackAccessException;
import com.liveclass.video.api.PlaybackAccessGrant;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

/**
 * video가 선언한 {@link LessonPlaybackAccess}를 curriculum이 구현한다 — 레슨→섹션→커리큘럼→수강·소유
 * 관계는 curriculum 쪽 지식이다. 의존 방향은 curriculum → video 로 {@code ReplayDirectory} 소비와 같다(순환 없음).
 *
 * <p>{@link LessonLearningAccessImpl}와 판정 뼈대는 같되(레슨 존재→커리큘럼 해석→관계 확인), 게이트가
 * 다르다: 학습은 소유 강사도 미수강이면 막지만, 재생은 <b>소유 강사를 검수 목적으로 통과</b>시킨다.
 * 존재하지 않으면 404(은닉), 소유도 활성 수강도 아니면 403.
 */
@Component
public class LessonPlaybackAccessImpl implements LessonPlaybackAccess {

    private final LessonDirectory lessonDirectory;
    private final SectionRepository sectionRepository;
    private final CurriculumRepository curriculumRepository;
    private final EnrollmentDirectory enrollmentDirectory;

    public LessonPlaybackAccessImpl(LessonDirectory lessonDirectory,
                                    SectionRepository sectionRepository,
                                    CurriculumRepository curriculumRepository,
                                    EnrollmentDirectory enrollmentDirectory) {
        this.lessonDirectory = lessonDirectory;
        this.sectionRepository = sectionRepository;
        this.curriculumRepository = curriculumRepository;
        this.enrollmentDirectory = enrollmentDirectory;
    }

    @Override
    @Transactional(readOnly = true)
    public PlaybackAccessGrant resolve(UUID userId, UUID lessonId) {
        LessonDetailView lesson = lessonDirectory.findDetail(lessonId).orElseThrow(this::notFound);
        Section section = sectionRepository.findById(lesson.sectionId()).orElseThrow(this::notFound);
        Curriculum curriculum = curriculumRepository.findById(section.getCurriculumId()).orElseThrow(this::notFound);

        if (userId.equals(curriculum.getInstructorId())) {
            return new PlaybackAccessGrant(true);   // 소유 강사 — 검수 목적으로 게시 전에도 본다.
        }
        if (enrollmentDirectory.isActive(curriculum.getId(), userId)) {
            return new PlaybackAccessGrant(false);  // 활성 수강생 — 게시본만(게이트는 video).
        }
        // 존재는 공개 목차로 이미 드러나므로 숨길 것이 없다 — 미수강은 403.
        throw new PlaybackAccessException(
                PlaybackAccessException.Reason.ENROLLMENT_REQUIRED, "이 강의를 수강해야 다시보기를 볼 수 있습니다.");
    }

    private PlaybackAccessException notFound() {
        return new PlaybackAccessException(
                PlaybackAccessException.Reason.NOT_FOUND, "레슨을 찾을 수 없습니다.");
    }
}
