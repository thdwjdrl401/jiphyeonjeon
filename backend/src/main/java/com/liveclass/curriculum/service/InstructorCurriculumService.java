package com.liveclass.curriculum.service;

import com.liveclass.aiintegration.api.OutboxPublisher;
import com.liveclass.asset.api.AssetDirectory;
import com.liveclass.asset.api.AssetRef;
import com.liveclass.curriculum.domain.Curriculum;
import com.liveclass.curriculum.domain.CurriculumLifecycleStatus;
import com.liveclass.curriculum.domain.EnrollmentType;
import com.liveclass.curriculum.domain.Section;
import com.liveclass.curriculum.repository.CurriculumRepository;
import com.liveclass.curriculum.repository.SectionRepository;
import com.liveclass.common.logging.Audit;
import com.liveclass.lesson.api.LessonDirectory;
import com.liveclass.lesson.api.LessonManagement;
import com.liveclass.lesson.api.LessonMaterialManagement;
import com.liveclass.lesson.api.LessonPlacement;
import com.liveclass.lesson.api.LessonView;
import com.liveclass.lesson.api.MaterialView;
import com.liveclass.live.api.LiveSessionDirectory;
import com.liveclass.live.api.LiveSessionManagement;
import com.liveclass.live.api.LiveSessionView;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

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
    private final LessonMaterialManagement lessonMaterialManagement;
    private final LiveSessionManagement liveSessionManagement;
    private final LiveSessionDirectory liveSessionDirectory;
    private final AssetDirectory assetDirectory;
    private final OutboxPublisher outboxPublisher;
    private final boolean embeddingEnabled;
    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    public InstructorCurriculumService(CurriculumRepository curriculumRepository,
                                       SectionRepository sectionRepository,
                                       LessonDirectory lessonDirectory,
                                       LessonManagement lessonManagement,
                                       LessonMaterialManagement lessonMaterialManagement,
                                       LiveSessionManagement liveSessionManagement,
                                       LiveSessionDirectory liveSessionDirectory,
                                       AssetDirectory assetDirectory,
                                       OutboxPublisher outboxPublisher,
                                       @Value("${material.embedding.enabled:false}") boolean embeddingEnabled) {
        this.curriculumRepository = curriculumRepository;
        this.sectionRepository = sectionRepository;
        this.lessonDirectory = lessonDirectory;
        this.lessonManagement = lessonManagement;
        this.lessonMaterialManagement = lessonMaterialManagement;
        this.liveSessionManagement = liveSessionManagement;
        this.liveSessionDirectory = liveSessionDirectory;
        this.assetDirectory = assetDirectory;
        this.outboxPublisher = outboxPublisher;
        this.embeddingEnabled = embeddingEnabled;
    }

    @Transactional
    public Curriculum create(UUID instructorId, String title, String summary, String description,
                             UUID thumbnailAssetId) {
        Curriculum curriculum = new Curriculum();
        curriculum.setInstructorId(instructorId);
        curriculum.setTitle(title);
        curriculum.setSummary(summary);
        curriculum.setDescription(description);
        applyThumbnail(curriculum, instructorId, thumbnailAssetId);
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

    /**
     * 강사 운영 목록(MY-CURRICULUM-02). 소유자 본인 커리큘럼만, 제목검색·상태필터·정렬·페이지로 조회한다.
     *
     * <p>N+1을 만들지 않는 것이 이 메서드의 핵심 제약이다. 페이지를 먼저 자른 뒤 부가정보를
     * <b>세 번의 배치 조회</b>로만 채운다 — 썸네일 URL(asset.api), 커리큘럼별 다음 세션(live.api),
     * 그 세션들의 레슨 제목(lesson.api). 행 수와 무관하게 쿼리 수가 고정된다.
     *
     * <p>타 모듈 데이터는 전부 포트(api 패키지)로만 얻는다 — live_session이 curriculum_id를
     * 비정규화해 들고 있어 모듈 간 조인 없이 live 안에서 해결된다.
     */
    @Transactional(readOnly = true)
    public Page<InstructorCurriculumCard> listMine(UUID instructorId, String q,
                                                   CurriculumLifecycleStatus status,
                                                   InstructorCurriculumSort sort, int page, int size) {
        Pageable pageable = PageRequest.of(page, size, sort.toSort());
        String normalizedQuery = (q == null || q.isBlank()) ? null : q.trim();

        Page<Curriculum> found = findMine(instructorId, normalizedQuery, status, pageable);
        List<Curriculum> content = found.getContent();

        // (1) 썸네일 URL 배치 해석.
        Map<UUID, String> thumbnails = assetDirectory.resolveUrls(content.stream()
                .map(Curriculum::getThumbnailAssetId).filter(Objects::nonNull).toList());
        // (2) 페이지 전체의 다음 예정 세션을 한 쿼리로.
        Map<UUID, LiveSessionView> nextSessions = liveSessionDirectory.nextScheduledByCurriculum(
                content.stream().map(Curriculum::getId).toList());
        // (3) 그 세션들이 걸린 레슨 제목도 한 쿼리로.
        Map<UUID, String> lessonTitles = lessonDirectory.findTitles(nextSessions.values().stream()
                .map(LiveSessionView::lessonId).distinct().toList());

        return found.map(c -> toCard(c, thumbnails, nextSessions, lessonTitles));
    }

    private Page<Curriculum> findMine(UUID instructorId, String q, CurriculumLifecycleStatus status,
                                      Pageable pageable) {
        if (q == null && status == null) {
            return curriculumRepository.findByInstructorId(instructorId, pageable);
        }
        if (q == null) {
            return curriculumRepository.findByInstructorIdAndLifecycleStatus(instructorId, status, pageable);
        }
        if (status == null) {
            return curriculumRepository.findByInstructorIdAndTitleContainingIgnoreCase(instructorId, q, pageable);
        }
        return curriculumRepository.findByInstructorIdAndLifecycleStatusAndTitleContainingIgnoreCase(
                instructorId, status, q, pageable);
    }

    private InstructorCurriculumCard toCard(Curriculum c, Map<UUID, String> thumbnails,
                                            Map<UUID, LiveSessionView> nextSessions,
                                            Map<UUID, String> lessonTitles) {
        LiveSessionView next = nextSessions.get(c.getId());
        InstructorNextLiveSession nextLiveSession = next == null ? null : new InstructorNextLiveSession(
                next.sessionId(),
                next.lessonId(),
                lessonTitles.get(next.lessonId()),
                next.scheduledAt(),
                next.liveSessionStatus());
        return new InstructorCurriculumCard(
                c.getId(),
                c.getTitle(),
                c.getSummary(),
                c.getThumbnailAssetId() == null ? null : thumbnails.get(c.getThumbnailAssetId()),
                c.getLifecycleStatus().name(),
                c.getSectionCount(),
                c.getLessonCount(),
                c.getPublishedLessonCount(),
                nextLiveSession);
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
                                      OffsetDateTime startsAt, OffsetDateTime endsAt,
                                      UUID thumbnailAssetId) {
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
        applyThumbnail(curriculum, instructorId, thumbnailAssetId);
        return curriculum;
    }

    /**
     * 썸네일 에셋 지정(선택). null이면 변경 안 함. 지정 시 asset.api로 검증한다 — 본인이 올린,
     * 종류 THUMBNAIL, 완료(UPLOADED)여야 한다. 어긋나면 상태 충돌(409)로 막는다. asset 엔티티에는
     * 직접 접근하지 않고 포트(AssetDirectory)만 쓴다(모듈 경계).
     */
    private void applyThumbnail(Curriculum curriculum, UUID instructorId, UUID thumbnailAssetId) {
        if (thumbnailAssetId == null) {
            return;
        }
        AssetRef ref = assetDirectory.find(thumbnailAssetId)
                .orElseThrow(() -> new CurriculumStateConflictException("썸네일 에셋을 찾을 수 없습니다."));
        if (!instructorId.equals(ref.uploadedBy())
                || !"THUMBNAIL".equals(ref.kind())
                || !"UPLOADED".equals(ref.status())) {
            throw new CurriculumStateConflictException("유효하지 않은 썸네일 에셋입니다.");
        }
        curriculum.setThumbnailAssetId(thumbnailAssetId);
    }

    @Transactional(readOnly = true)
    public List<Section> listSections(UUID instructorId, UUID curriculumId) {
        requireOwned(instructorId, curriculumId);
        return sectionRepository.findByCurriculumIdOrderByOrderIndexAsc(curriculumId);
    }

    @Transactional
    public Section createSection(UUID instructorId, UUID curriculumId, String title, String description) {
        requireOwned(instructorId, curriculumId);

        Section section = new Section();
        section.setCurriculumId(curriculumId);
        section.setTitle(title);
        section.setDescription(description);
        // 새 섹션은 맨 뒤에 붙인다. UNIQUE(curriculum_id, order_index)와 충돌하지 않도록 마지막+1.
        section.setOrderIndex(nextSectionOrder(curriculumId));
        Section saved = sectionRepository.save(section);

        // section_count는 DB 트리거가 유지한다(앱이 건드리면 이중 반영). 여기선 목차 변경을
        // 감지시키는 structure_version만 올린다 — 트리거는 이 컬럼을 건드리지 않는다.
        curriculumRepository.bumpStructureVersion(curriculumId);
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

        UUID curriculumId = section.getCurriculumId();
        sectionRepository.delete(section);
        // section_count는 트리거가 −1 한다(앱은 건드리지 않음). structure_version만 올린다.
        curriculumRepository.bumpStructureVersion(curriculumId);
        log.info(Audit.MARKER, "섹션 삭제 curriculumId={} sectionId={}", curriculumId, sectionId);
    }

    // ── 레슨 관리 ── 데이터 조작은 lesson 모듈 포트가, 소유권·구조버전은 여기(curriculum)가 책임진다.

    @Transactional
    public LessonView createLesson(UUID instructorId, UUID sectionId, String title, String description) {
        Section section = requireOwnedSection(instructorId, sectionId);
        LessonView lesson = lessonManagement.create(sectionId, title, description);
        // lesson_count는 트리거가 유지. 목차 변경이므로 structure_version만 올린다.
        // (소유권은 requireOwnedSection이 이미 커리큘럼까지 확인했다.)
        curriculumRepository.bumpStructureVersion(section.getCurriculumId());
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

    /**
     * 강사 레슨 단건 + 연결된 활성 자료(ADR-0035) + 이 레슨의 라이브 세션 — 수정 폼이 저장된 자료와
     * 라이브 일정을 다시 보여주도록. 세션은 레슨당 최대 하나라 배치 조회 결과의 첫 건을 취한다.
     */
    @Transactional(readOnly = true)
    public InstructorLessonDetail getLessonDetail(UUID instructorId, UUID lessonId) {
        LessonView lesson = requireOwnedLesson(instructorId, lessonId);
        LiveSessionView liveSession = liveSessionDirectory.findByLessons(List.of(lessonId)).stream()
                .findFirst().orElse(null);
        return new InstructorLessonDetail(lesson, lessonMaterialManagement.findActiveByLesson(lessonId), liveSession);
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
        curriculumRepository.bumpStructureVersion(section.getCurriculumId());
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
        curriculumRepository.bumpStructureVersion(section.getCurriculumId());
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
        curriculumRepository.bumpStructureVersion(section.getCurriculumId());
        log.info(Audit.MARKER, "레슨 게시취소 sectionId={} lessonId={}", lesson.sectionId(), lessonId);
        return unpublished;
    }

    /**
     * 레슨에 자료(PPTX) 에셋을 연결한다(ADR-0035). 소유권(레슨→섹션→커리큘럼)은 여기서 확인하고,
     * 에셋 유효성 검증과 연결 저장은 lesson 모듈 포트가 한다. 에셋 업로더 검증에 쓰라고 instructorId를
     * 넘긴다(레슨 소유권과 별개로 자기 에셋만 붙일 수 있게). AI 잡 발행은 이번 범위 밖(CP3).
     */
    @Transactional
    public MaterialView attachMaterial(UUID instructorId, UUID lessonId, UUID assetId) {
        LessonView lesson = requireOwnedLesson(instructorId, lessonId);
        MaterialView material = lessonMaterialManagement.attach(lessonId, assetId, instructorId);
        log.info(Audit.MARKER, "레슨 자료 연결 lessonId={} assetId={} materialId={}",
                lessonId, assetId, material.materialId());
        // 임베딩 파이프라인이 켜져 있으면 PENDING으로 두고 잡을 outbox에 싣는다(같은 트랜잭션 = 신뢰성, ADR-0036).
        // 꺼져 있으면(기본) 연결만 하고 상태는 READY 유지 — 파이프라인 미배선 단계의 무회귀.
        if (embeddingEnabled) {
            UUID curriculumId = requireOwnedSection(instructorId, lesson.sectionId()).getCurriculumId();
            lessonMaterialManagement.updateEmbeddingStatus(material.materialId(), "PENDING");
            enqueueEmbedJob(curriculumId, lessonId, material);
        }
        return material;
    }

    /** 레슨 자료 연결 해제(소프트 삭제). 소유권 확인 후 위임. 멱등(없는 자료여도 성공). */
    @Transactional
    public void detachMaterial(UUID instructorId, UUID lessonId, UUID materialId) {
        requireOwnedLesson(instructorId, lessonId);
        lessonMaterialManagement.detach(lessonId, materialId);
        // 임베딩 파이프라인이 켜져 있으면 pgvector에서 이 자료 chunk를 지우도록 삭제 잡을 싣는다(ADR-0036).
        if (embeddingEnabled) {
            String payload = jsonMapper.writeValueAsString(Map.of(
                    "taskType", "EMBED_DELETE",
                    "materialId", materialId.toString(),
                    "lessonId", lessonId.toString(),
                    "contractVersion", 1));
            outboxPublisher.enqueue("material_asset", materialId.toString(), "MATERIAL_EMBED_DELETE",
                    payload, "material:" + materialId + ":embed-delete", null);
        }
    }

    /** 자료 임베딩 잡을 outbox에 싣는다(CONTRACT §3-1 envelope, taskType=PPTX_EMBED, 모델 bge-m3). */
    private void enqueueEmbedJob(UUID curriculumId, UUID lessonId, MaterialView material) {
        String payload = jsonMapper.writeValueAsString(Map.of(
                "taskType", "PPTX_EMBED",
                "materialId", material.materialId().toString(),
                "assetId", material.assetId().toString(),
                "lessonId", lessonId.toString(),
                "curriculumId", curriculumId.toString(),
                "fileName", material.fileName() == null ? "" : material.fileName(),
                "policy", Map.of("embedModel", "bge-m3"),
                "contractVersion", 1));
        outboxPublisher.enqueue("material_asset", material.materialId().toString(), "MATERIAL_EMBED_REQUESTED",
                payload, "material:" + material.materialId() + ":embed", null);
    }

    /**
     * 레슨 자료 다운로드용 presigned GET URL. 소유권 확인 후, 그 레슨의 활성 자료 중 materialId를 찾아
     * 에셋의 presigned URL을 발급한다. 바이트는 스토리지 직결이라 이 URL로 302 리다이렉트만 하면 된다.
     */
    @Transactional(readOnly = true)
    public String materialDownloadUrl(UUID instructorId, UUID lessonId, UUID materialId) {
        requireOwnedLesson(instructorId, lessonId);
        MaterialView material = lessonMaterialManagement.findActiveByLesson(lessonId).stream()
                .filter(m -> m.materialId().equals(materialId))
                .findFirst()
                .orElseThrow(() -> new LessonNotFoundException("자료를 찾을 수 없습니다."));
        return assetDirectory.resolveUrl(material.assetId())
                .orElseThrow(() -> new LessonNotFoundException("자료 URL을 발급할 수 없습니다."));
    }

    // ── 구조 순서 원자 저장 (STRUCTURE-01) ──

    /**
     * 섹션 순서와 각 섹션의 레슨 순서를 한 트랜잭션에서 통째로 저장한다.
     *
     * <p>검증은 전부 쓰기 전에 끝낸다 — 요청의 섹션 목록은 이 커리큘럼의 현재 섹션 집합과 정확히
     * 일치(순열)해야 하고, 모든 lessonIds의 합집합도 현재 레슨 집합과 정확히 일치해야 한다.
     * 누락·중복·외부 ID 중 하나라도 있으면 전체 요청을 실패시킨다(부분 적용 없음).
     * 레슨은 같은 커리큘럼 안이라면 다른 섹션으로 옮길 수 있고, 이때 section_id도 함께 갱신된다.
     *
     * <p>order_index는 0-based로 0..n-1을 그대로 재배정한다. uq_section_order·uq_lesson_order가
     * DEFERRABLE INITIALLY DEFERRED라 트랜잭션 중간의 일시적 중복은 문제가 되지 않는다.
     *
     * <p>동시성은 structure_version compare-and-set으로 잡는다. 0행이면 그 사이 누군가 구조를
     * 바꾼 것이므로 최신 버전을 실어 409로 알린다.
     */
    @Transactional
    public StructureOrder reorderStructure(UUID instructorId, UUID curriculumId,
                                           int baseVersion, List<SectionOrderCommand> commands) {
        requireOwned(instructorId, curriculumId);

        List<Section> currentSections = sectionRepository.findByCurriculumIdOrderByOrderIndexAsc(curriculumId);
        Map<UUID, Section> sectionsById = currentSections.stream()
                .collect(Collectors.toMap(Section::getId, section -> section));

        requireExactPermutation("섹션", sectionsById.keySet(),
                commands.stream().map(SectionOrderCommand::sectionId).toList());

        Set<UUID> currentLessonIds = lessonManagement.findBySections(sectionsById.keySet()).stream()
                .map(LessonView::lessonId)
                .collect(Collectors.toCollection(LinkedHashSet::new));

        requireExactPermutation("레슨", currentLessonIds,
                commands.stream().flatMap(command -> command.lessonIds().stream()).toList());

        // 적용: 섹션은 0..n-1, 각 섹션 안의 레슨도 0..m-1. 이동한 레슨은 section_id까지 바뀐다.
        List<LessonPlacement> placements = new ArrayList<>();
        List<StructureOrder.SectionOrder> applied = new ArrayList<>();
        for (int sectionOrder = 0; sectionOrder < commands.size(); sectionOrder++) {
            SectionOrderCommand command = commands.get(sectionOrder);
            sectionsById.get(command.sectionId()).setOrderIndex(sectionOrder);

            List<UUID> lessonIds = command.lessonIds();
            List<StructureOrder.LessonOrder> lessons = new ArrayList<>();
            for (int lessonOrder = 0; lessonOrder < lessonIds.size(); lessonOrder++) {
                placements.add(new LessonPlacement(lessonIds.get(lessonOrder), command.sectionId(), lessonOrder));
                lessons.add(new StructureOrder.LessonOrder(lessonIds.get(lessonOrder), lessonOrder));
            }
            applied.add(new StructureOrder.SectionOrder(command.sectionId(), sectionOrder, lessons));
        }
        lessonManagement.applyPlacements(placements);

        // compare-and-set. 여기서 flush가 일어나 위의 순서 변경이 먼저 DB로 나간다.
        if (curriculumRepository.bumpStructureVersionIfMatches(curriculumId, baseVersion) == 0) {
            int latest = curriculumRepository.findById(curriculumId)
                    .map(Curriculum::getStructureVersion)
                    .orElseThrow(() -> new CurriculumNotFoundException("커리큘럼을 찾을 수 없습니다."));
            throw new StructureVersionConflictException(
                    "구조가 이미 변경되었습니다(최신 structureVersion=" + latest + "). 다시 조회해 주세요.", latest);
        }

        log.info(Audit.MARKER, "구조 순서 저장 curriculumId={} structureVersion={}",
                curriculumId, baseVersion + 1);
        return new StructureOrder(baseVersion + 1, applied);
    }

    /**
     * 요청 ID 목록이 현재 집합의 정확한 순열인지 검사한다. 중복·외부 ID·누락을 각각 구분해서 알린다.
     * 어떤 것도 쓰기 전에 호출해야 부분 적용이 생기지 않는다.
     */
    private void requireExactPermutation(String label, Set<UUID> current, List<UUID> requested) {
        Set<UUID> seen = new LinkedHashSet<>();
        for (UUID id : requested) {
            if (!seen.add(id)) {
                throw new StructureInvalidException(label + " ID가 중복되었습니다: " + id);
            }
            if (!current.contains(id)) {
                throw new StructureInvalidException("이 커리큘럼의 " + label + "이 아닙니다: " + id);
            }
        }
        if (seen.size() != current.size()) {
            Set<UUID> missing = new LinkedHashSet<>(current);
            missing.removeAll(seen);
            throw new StructureInvalidException(label + " ID가 누락되었습니다: " + missing);
        }
    }

    // ── 라이브 세션 생성 ── 소유권(레슨→커리큘럼)은 여기서, 세션 데이터는 live 모듈 포트가.

    @Transactional
    public LiveSessionView createLiveSession(UUID instructorId, UUID lessonId, java.time.OffsetDateTime scheduledAt) {
        LessonView lesson = requireOwnedLesson(instructorId, lessonId);
        // 세션에 소속 커리큘럼을 실어 접근 게이팅에 쓴다(session→enrollment 사이클 회피).
        UUID curriculumId = requireOwnedSection(instructorId, lesson.sectionId()).getCurriculumId();
        // 레슨당 세션 1개(DDL UNIQUE). 이미 있으면 상태 충돌로 막는다.
        if (liveSessionDirectory.existsForLesson(lessonId)) {
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
