package com.liveclass.curriculum.service;

import com.liveclass.curriculum.domain.Curriculum;
import com.liveclass.curriculum.domain.CurriculumLifecycleStatus;
import com.liveclass.curriculum.domain.EnrollmentType;
import com.liveclass.curriculum.domain.Section;
import com.liveclass.curriculum.repository.CurriculumRepository;
import com.liveclass.curriculum.repository.SectionRepository;
import com.liveclass.common.logging.Audit;
import com.liveclass.lesson.api.LessonDirectory;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

/**
 * 강사가 소유한 커리큘럼·섹션의 관리(CRUD). 소유권은 curriculum.instructorId로 판정한다.
 * 레슨 발행·순서 원자저장·수강 승인은 이 서비스 범위 밖(후속).
 */
@Service
public class InstructorCurriculumService {

    private static final Logger log = LoggerFactory.getLogger(InstructorCurriculumService.class);

    private final CurriculumRepository curriculumRepository;
    private final SectionRepository sectionRepository;
    private final LessonDirectory lessonDirectory;

    public InstructorCurriculumService(CurriculumRepository curriculumRepository,
                                       SectionRepository sectionRepository,
                                       LessonDirectory lessonDirectory) {
        this.curriculumRepository = curriculumRepository;
        this.sectionRepository = sectionRepository;
        this.lessonDirectory = lessonDirectory;
    }

    @Transactional
    public Curriculum create(UUID instructorId, String title, String summary, String description) {
        Curriculum curriculum = new Curriculum();
        curriculum.setInstructorId(instructorId);
        curriculum.setTitle(title);
        curriculum.setSummary(summary);
        curriculum.setDescription(description);
        // 생성 시점 기본값은 DDL과 일치시킨다(초안·즉시수강). 발행은 별도 흐름에서.
        curriculum.setLifecycleStatus(CurriculumLifecycleStatus.DRAFT);
        curriculum.setEnrollmentType(EnrollmentType.IMMEDIATE);
        curriculum.setStructureVersion(0);
        curriculum.setSectionCount(0);
        curriculum.setLessonCount(0);
        curriculum.setPublishedLessonCount(0);
        Curriculum saved = curriculumRepository.save(curriculum);
        log.info(Audit.MARKER, "커리큘럼 생성 curriculumId={} instructorId={}", saved.getId(), instructorId);
        return saved;
    }

    @Transactional(readOnly = true)
    public List<Curriculum> listMine(UUID instructorId) {
        return curriculumRepository.findByInstructorIdOrderByCreatedAtDesc(instructorId);
    }

    @Transactional(readOnly = true)
    public Curriculum getOwned(UUID instructorId, UUID curriculumId) {
        return requireOwned(instructorId, curriculumId);
    }

    /** null 인자는 "변경 안 함"으로 다룬다 — PATCH 부분 수정. */
    @Transactional
    public Curriculum updateBasicInfo(UUID instructorId, UUID curriculumId,
                                      String title, String summary, String description) {
        Curriculum curriculum = requireOwned(instructorId, curriculumId);
        if (title != null) {
            curriculum.setTitle(title);
        }
        if (summary != null) {
            curriculum.setSummary(summary);
        }
        if (description != null) {
            curriculum.setDescription(description);
        }
        return curriculum;
    }

    @Transactional(readOnly = true)
    public List<Section> listSections(UUID instructorId, UUID curriculumId) {
        requireOwned(instructorId, curriculumId);
        return sectionRepository.findByCurriculumIdOrderByOrderIndexAsc(curriculumId);
    }

    @Transactional
    public Section createSection(UUID instructorId, UUID curriculumId, String title, String description) {
        Curriculum curriculum = requireOwned(instructorId, curriculumId);

        Section section = new Section();
        section.setCurriculumId(curriculumId);
        section.setTitle(title);
        section.setDescription(description);
        // 새 섹션은 맨 뒤에 붙인다. UNIQUE(curriculum_id, order_index)와 충돌하지 않도록 마지막+1.
        section.setOrderIndex(nextSectionOrder(curriculumId));
        Section saved = sectionRepository.save(section);

        // section_count는 DB 트리거가 유지한다(앱이 건드리면 이중 반영). 여기선 목차 변경을
        // 감지시키는 structure_version만 올린다 — 트리거는 이 컬럼을 건드리지 않는다.
        curriculum.setStructureVersion(curriculum.getStructureVersion() + 1);
        log.info(Audit.MARKER, "섹션 생성 curriculumId={} sectionId={}", curriculumId, saved.getId());
        return saved;
    }

    @Transactional
    public Section updateSection(UUID instructorId, UUID sectionId, String title, String description) {
        Section section = requireOwnedSection(instructorId, sectionId);
        if (title != null) {
            section.setTitle(title);
        }
        if (description != null) {
            section.setDescription(description);
        }
        return section;
    }

    @Transactional
    public void deleteSection(UUID instructorId, UUID sectionId) {
        Section section = requireOwnedSection(instructorId, sectionId);

        // 레슨이 남은 섹션 삭제는 캐스케이드로 레슨까지 지워버리므로 막는다 — 실수 방지.
        if (lessonDirectory.countInSection(sectionId) > 0) {
            throw new SectionNotEmptyException("레슨이 있는 섹션은 삭제할 수 없습니다.");
        }

        Curriculum curriculum = requireOwned(instructorId, section.getCurriculumId());
        sectionRepository.delete(section);
        // section_count는 트리거가 −1 한다(앱은 건드리지 않음). structure_version만 올린다.
        curriculum.setStructureVersion(curriculum.getStructureVersion() + 1);
        log.info(Audit.MARKER, "섹션 삭제 curriculumId={} sectionId={}", section.getCurriculumId(), sectionId);
    }

    private int nextSectionOrder(UUID curriculumId) {
        return sectionRepository.findTopByCurriculumIdOrderByOrderIndexDesc(curriculumId)
                .map(last -> last.getOrderIndex() + 1)
                .orElse(0);
    }

    private Curriculum requireOwned(UUID instructorId, UUID curriculumId) {
        Curriculum curriculum = curriculumRepository.findById(curriculumId)
                .orElseThrow(() -> new CurriculumNotFoundException("커리큘럼을 찾을 수 없습니다."));
        if (!curriculum.getInstructorId().equals(instructorId)) {
            throw new NotCurriculumOwnerException("이 커리큘럼의 소유자가 아닙니다.");
        }
        return curriculum;
    }

    private Section requireOwnedSection(UUID instructorId, UUID sectionId) {
        Section section = sectionRepository.findById(sectionId)
                .orElseThrow(() -> new SectionNotFoundException("섹션을 찾을 수 없습니다."));
        requireOwned(instructorId, section.getCurriculumId());
        return section;
    }
}
