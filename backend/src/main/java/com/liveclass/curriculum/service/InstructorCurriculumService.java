package com.liveclass.curriculum.service;

import com.liveclass.curriculum.domain.Curriculum;
import com.liveclass.curriculum.domain.CurriculumLifecycleStatus;
import com.liveclass.curriculum.domain.EnrollmentType;
import com.liveclass.curriculum.domain.Section;
import com.liveclass.curriculum.repository.CurriculumRepository;
import com.liveclass.curriculum.repository.SectionRepository;
import com.liveclass.common.logging.Audit;
import com.liveclass.lesson.api.LessonDirectory;
import com.liveclass.lesson.api.LessonManagement;
import com.liveclass.lesson.api.LessonView;
import com.liveclass.live.api.LiveSessionManagement;
import com.liveclass.live.api.LiveSessionView;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
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
    private final LessonManagement lessonManagement;
    private final LiveSessionManagement liveSessionManagement;

    public InstructorCurriculumService(CurriculumRepository curriculumRepository,
                                       SectionRepository sectionRepository,
                                       LessonDirectory lessonDirectory,
                                       LessonManagement lessonManagement,
                                       LiveSessionManagement liveSessionManagement) {
        this.curriculumRepository = curriculumRepository;
        this.sectionRepository = sectionRepository;
        this.lessonDirectory = lessonDirectory;
        this.lessonManagement = lessonManagement;
        this.liveSessionManagement = liveSessionManagement;
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
        // 제품 정책: 승인제(학생 신청 → 강사 승인). enum은 즉시·초대도 지원하나 기본은 승인제.
        curriculum.setEnrollmentType(EnrollmentType.APPROVAL_REQUIRED);
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

    /**
     * 발행: DRAFT → PUBLISHED. 발행 순간 카탈로그에 노출된다(카탈로그는 PUBLISHED만 조회).
     * FE 설계대로 일반 수정(PATCH)과 분리된 command다. 전제조건(예: 레슨 게시 여부)·모집 연동·
     * 영향 요약은 정책 미확정이라 이번 범위 밖 — 상태 전이만 최소로 구현한다.
     */
    @Transactional
    public Curriculum publish(UUID instructorId, UUID curriculumId) {
        Curriculum curriculum = requireOwned(instructorId, curriculumId);
        if (curriculum.getLifecycleStatus() != CurriculumLifecycleStatus.DRAFT) {
            throw new CurriculumStateConflictException("DRAFT 상태에서만 발행할 수 있습니다.");
        }
        curriculum.setLifecycleStatus(CurriculumLifecycleStatus.PUBLISHED);
        curriculum.setPublishedAt(OffsetDateTime.now());
        log.info(Audit.MARKER, "커리큘럼 발행 curriculumId={} instructorId={}", curriculumId, instructorId);
        return curriculum;
    }

    /** 보관: PUBLISHED → ARCHIVED. 카탈로그에서 내려간다. 되돌리기·삭제 정책은 범위 밖. */
    @Transactional
    public Curriculum archive(UUID instructorId, UUID curriculumId) {
        Curriculum curriculum = requireOwned(instructorId, curriculumId);
        if (curriculum.getLifecycleStatus() != CurriculumLifecycleStatus.PUBLISHED) {
            throw new CurriculumStateConflictException("PUBLISHED 상태에서만 보관할 수 있습니다.");
        }
        curriculum.setLifecycleStatus(CurriculumLifecycleStatus.ARCHIVED);
        log.info(Audit.MARKER, "커리큘럼 보관 curriculumId={} instructorId={}", curriculumId, instructorId);
        return curriculum;
    }

    /** null 인자는 "변경 안 함"으로 다룬다 — PATCH 부분 수정. 기간 검증 규칙은 미확정(골격). */
    @Transactional
    public Curriculum updateBasicInfo(UUID instructorId, UUID curriculumId,
                                      String title, String summary, String description,
                                      OffsetDateTime startsAt, OffsetDateTime endsAt) {
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
        if (startsAt != null) {
            curriculum.setStartsAt(startsAt);
        }
        if (endsAt != null) {
            curriculum.setEndsAt(endsAt);
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

    // ── 레슨 관리 ── 데이터 조작은 lesson 모듈 포트가, 소유권·구조버전은 여기(curriculum)가 책임진다.

    @Transactional
    public LessonView createLesson(UUID instructorId, UUID sectionId, String title, String description) {
        Section section = requireOwnedSection(instructorId, sectionId);
        LessonView lesson = lessonManagement.create(sectionId, title, description);
        // lesson_count는 트리거가 유지. 목차 변경이므로 structure_version만 올린다.
        Curriculum curriculum = requireOwned(instructorId, section.getCurriculumId());
        curriculum.setStructureVersion(curriculum.getStructureVersion() + 1);
        log.info(Audit.MARKER, "레슨 생성 sectionId={} lessonId={}", sectionId, lesson.lessonId());
        return lesson;
    }

    @Transactional(readOnly = true)
    public List<LessonView> listLessons(UUID instructorId, UUID sectionId) {
        requireOwnedSection(instructorId, sectionId);
        return lessonManagement.findBySection(sectionId);
    }

    @Transactional(readOnly = true)
    public LessonView getLesson(UUID instructorId, UUID lessonId) {
        return requireOwnedLesson(instructorId, lessonId);
    }

    @Transactional
    public LessonView updateLesson(UUID instructorId, UUID lessonId, String title, String description) {
        requireOwnedLesson(instructorId, lessonId);
        return lessonManagement.update(lessonId, title, description);
    }

    @Transactional
    public void deleteLesson(UUID instructorId, UUID lessonId) {
        LessonView lesson = requireOwnedLesson(instructorId, lessonId);
        lessonManagement.delete(lessonId);
        // lesson_count는 트리거가 −1. 구조 변경이므로 structure_version만 올린다.
        Section section = requireOwnedSection(instructorId, lesson.sectionId());
        Curriculum curriculum = requireOwned(instructorId, section.getCurriculumId());
        curriculum.setStructureVersion(curriculum.getStructureVersion() + 1);
        log.info(Audit.MARKER, "레슨 삭제 sectionId={} lessonId={}", lesson.sectionId(), lessonId);
    }

    /**
     * 레슨 발행: DRAFT → PUBLISHED (MVP 직행, AI 준비도 게이팅 없음 — ADR-0021).
     * 발행 순간 공개 목차(카탈로그)에 노출되므로 목차 변경으로 보고 structure_version을 올린다.
     */
    @Transactional
    public LessonView publishLesson(UUID instructorId, UUID lessonId) {
        LessonView lesson = requireOwnedLesson(instructorId, lessonId);
        if ("PUBLISHED".equals(lesson.status())) {
            throw new CurriculumStateConflictException("이미 게시된 레슨입니다.");
        }
        LessonView published = lessonManagement.publish(lessonId);
        // 목차(학생 노출)가 바뀌므로 structure_version만 올린다(deleteLesson과 동일 패턴).
        Section section = requireOwnedSection(instructorId, lesson.sectionId());
        Curriculum curriculum = requireOwned(instructorId, section.getCurriculumId());
        curriculum.setStructureVersion(curriculum.getStructureVersion() + 1);
        log.info(Audit.MARKER, "레슨 발행 sectionId={} lessonId={}", lesson.sectionId(), lessonId);
        return published;
    }

    /** 레슨 게시취소: PUBLISHED → DRAFT. 공개 목차에서 내려가므로 structure_version을 올린다. */
    @Transactional
    public LessonView unpublishLesson(UUID instructorId, UUID lessonId) {
        LessonView lesson = requireOwnedLesson(instructorId, lessonId);
        if (!"PUBLISHED".equals(lesson.status())) {
            throw new CurriculumStateConflictException("게시되지 않은 레슨입니다.");
        }
        LessonView unpublished = lessonManagement.unpublish(lessonId);
        Section section = requireOwnedSection(instructorId, lesson.sectionId());
        Curriculum curriculum = requireOwned(instructorId, section.getCurriculumId());
        curriculum.setStructureVersion(curriculum.getStructureVersion() + 1);
        log.info(Audit.MARKER, "레슨 게시취소 sectionId={} lessonId={}", lesson.sectionId(), lessonId);
        return unpublished;
    }

    // ── 라이브 세션 생성 ── 소유권(레슨→커리큘럼)은 여기서, 세션 데이터는 live 모듈 포트가.

    @Transactional
    public LiveSessionView createLiveSession(UUID instructorId, UUID lessonId, java.time.OffsetDateTime scheduledAt) {
        LessonView lesson = requireOwnedLesson(instructorId, lessonId);
        // 세션에 소속 커리큘럼을 실어 접근 게이팅에 쓴다(session→enrollment 사이클 회피).
        UUID curriculumId = requireOwnedSection(instructorId, lesson.sectionId()).getCurriculumId();
        // 레슨당 세션 1개(DDL UNIQUE). 이미 있으면 상태 충돌로 막는다.
        if (liveSessionManagement.existsForLesson(lessonId)) {
            throw new CurriculumStateConflictException("이미 이 레슨의 라이브 세션이 있습니다.");
        }
        LiveSessionView session = liveSessionManagement.create(lessonId, curriculumId, instructorId, scheduledAt);
        log.info(Audit.MARKER, "라이브 세션 생성 lessonId={} sessionId={}", lessonId, session.sessionId());
        return session;
    }

    /** 레슨 → 섹션 → 커리큘럼 소유권 검증. 없으면 404, 소유자 아니면 403. */
    private LessonView requireOwnedLesson(UUID instructorId, UUID lessonId) {
        LessonView lesson = lessonManagement.findById(lessonId)
                .orElseThrow(() -> new LessonNotFoundException("레슨을 찾을 수 없습니다."));
        requireOwnedSection(instructorId, lesson.sectionId());
        return lesson;
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
