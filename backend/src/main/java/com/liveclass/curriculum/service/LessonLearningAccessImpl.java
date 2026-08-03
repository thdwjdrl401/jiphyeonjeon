package com.liveclass.curriculum.service;

import com.liveclass.curriculum.domain.Curriculum;
import com.liveclass.curriculum.domain.Section;
import com.liveclass.curriculum.repository.CurriculumRepository;
import com.liveclass.curriculum.repository.SectionRepository;
import com.liveclass.enrollment.api.EnrollmentDirectory;
import com.liveclass.learning.api.LessonLearningAccess;
import com.liveclass.learning.api.LessonNotLearnableException;
import com.liveclass.lesson.api.LessonDetailView;
import com.liveclass.lesson.api.LessonDirectory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

/**
 * learning이 선언한 {@link LessonLearningAccess}를 curriculum이 구현한다 — 레슨→섹션→커리큘럼→수강
 * 관계는 curriculum 쪽 지식이다. 의존 방향은 curriculum → learning 으로 progress 조회와 같다(순환 없음).
 *
 * <p>규칙은 수강생 레슨 상세({@link CatalogService#lessonDetail})와 같은 계열이다: 존재하지 않으면
 * 404(은닉), 활성 수강생이 아니면 403. 진도는 학생 기능이라 소유 강사는 대상이 아니다(미수강으로 403).
 */
@Component
public class LessonLearningAccessImpl implements LessonLearningAccess {

    private final LessonDirectory lessonDirectory;
    private final SectionRepository sectionRepository;
    private final EnrollmentDirectory enrollmentDirectory;
    private final CurriculumRepository curriculumRepository;

    public LessonLearningAccessImpl(LessonDirectory lessonDirectory,
                                    SectionRepository sectionRepository,
                                    EnrollmentDirectory enrollmentDirectory,
                                    CurriculumRepository curriculumRepository) {
        this.lessonDirectory = lessonDirectory;
        this.sectionRepository = sectionRepository;
        this.enrollmentDirectory = enrollmentDirectory;
        this.curriculumRepository = curriculumRepository;
    }

    @Override
    @Transactional(readOnly = true)
    public void ensureCanLearn(UUID userId, UUID lessonId) {
        LessonDetailView lesson = lessonDirectory.findDetail(lessonId)
                .orElseThrow(() -> notFound());
        Section section = sectionRepository.findById(lesson.sectionId())
                .orElseThrow(() -> notFound());
        if (!enrollmentDirectory.isActive(section.getCurriculumId(), userId)) {
            // 존재는 공개 목차로 이미 드러나므로 숨길 것이 없다 — 미수강은 403.
            throw new LessonNotLearnableException(
                    LessonNotLearnableException.Reason.FORBIDDEN, "이 강의를 수강해야 학습할 수 있습니다.");
        }
    }

    @Override
    @Transactional(readOnly = true)
    public void ensureCanViewInsights(UUID userId, UUID lessonId) {
        LessonDetailView lesson = lessonDirectory.findDetail(lessonId)
                .orElseThrow(() -> notFound());
        Section section = sectionRepository.findById(lesson.sectionId())
                .orElseThrow(() -> notFound());
        Curriculum curriculum = curriculumRepository.findById(section.getCurriculumId())
                .orElseThrow(() -> notFound());
        if (userId.equals(curriculum.getInstructorId())) {
            return;   // 소유 강사 — 재시청 그래프는 이 사람이 보라고 만든 것이다
        }
        if (enrollmentDirectory.isActive(section.getCurriculumId(), userId)) {
            return;   // 활성 수강생
        }
        throw new LessonNotLearnableException(
                LessonNotLearnableException.Reason.FORBIDDEN, "이 강의의 집계를 볼 수 없습니다.");
    }

    private LessonNotLearnableException notFound() {
        return new LessonNotLearnableException(
                LessonNotLearnableException.Reason.NOT_FOUND, "레슨을 찾을 수 없습니다.");
    }
}
