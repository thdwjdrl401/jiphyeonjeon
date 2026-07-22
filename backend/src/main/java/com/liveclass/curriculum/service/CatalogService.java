package com.liveclass.curriculum.service;

import com.liveclass.asset.api.AssetDirectory;
import com.liveclass.auth.api.InstructorDirectory;
import com.liveclass.auth.api.InstructorSummaryView;
import com.liveclass.curriculum.domain.Curriculum;
import com.liveclass.curriculum.domain.CurriculumLifecycleStatus;
import com.liveclass.curriculum.domain.Section;
import com.liveclass.curriculum.repository.CurriculumRepository;
import com.liveclass.curriculum.repository.SectionRepository;
import com.liveclass.lesson.api.LessonDirectory;
import com.liveclass.lesson.api.LessonOutlineView;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * 공개 커리큘럼 탐색(카탈로그). PUBLISHED만 노출한다.
 * 강사·레슨 정보는 각 모듈의 포트(InstructorDirectory·LessonDirectory)로만 얻는다 — 타 모듈
 * 엔티티에 직접 접근하지 않는다(모듈 경계, AGENTS.md).
 * 결과는 서비스 계층 타입({@link CatalogCard}·{@link CatalogDetail})으로 돌려주고 응답 DTO 변환은
 * 컨트롤러가 한다 — 서비스가 web 계층을 참조하지 않도록(InstructorCurriculumService와 동일 방향).
 * viewerContext·수강정책·추천(featured)은 범위 밖(후속).
 */
@Service
public class CatalogService {

    private final CurriculumRepository curriculumRepository;
    private final SectionRepository sectionRepository;
    private final LessonDirectory lessonDirectory;
    private final InstructorDirectory instructorDirectory;
    private final AssetDirectory assetDirectory;

    public CatalogService(CurriculumRepository curriculumRepository,
                          SectionRepository sectionRepository,
                          LessonDirectory lessonDirectory,
                          InstructorDirectory instructorDirectory,
                          AssetDirectory assetDirectory) {
        this.curriculumRepository = curriculumRepository;
        this.sectionRepository = sectionRepository;
        this.lessonDirectory = lessonDirectory;
        this.instructorDirectory = instructorDirectory;
        this.assetDirectory = assetDirectory;
    }

    @Transactional(readOnly = true)
    public Page<CatalogCard> list(String q, CatalogSort sort, int page, int size) {
        Pageable pageable = PageRequest.of(page, size, sort.toSort());
        String normalizedQuery = (q == null || q.isBlank()) ? null : q.trim();

        Page<Curriculum> found = (normalizedQuery == null)
                ? curriculumRepository.findByLifecycleStatus(CurriculumLifecycleStatus.PUBLISHED, pageable)
                : curriculumRepository.searchPublic(CurriculumLifecycleStatus.PUBLISHED, normalizedQuery, pageable);

        // 강사 정보를 카드마다 조회하면 N+1이라 한 번에 모아 맵으로 만든다.
        Map<UUID, CatalogInstructor> instructors = loadInstructors(
                found.getContent().stream().map(Curriculum::getInstructorId).distinct().toList());
        // 썸네일 URL도 배치로 해석(N+1 회피).
        Map<UUID, String> thumbnails = assetDirectory.resolveUrls(found.getContent().stream()
                .map(Curriculum::getThumbnailAssetId).filter(Objects::nonNull).toList());

        return found.map(c -> toCard(c, instructors.get(c.getInstructorId()), thumbnails));
    }

    @Transactional(readOnly = true)
    public CatalogDetail detail(UUID curriculumId) {
        // PUBLISHED가 아니면 존재를 드러내지 않고 404로 통일한다.
        Curriculum curriculum = curriculumRepository
                .findByIdAndLifecycleStatus(curriculumId, CurriculumLifecycleStatus.PUBLISHED)
                .orElseThrow(() -> new CurriculumNotFoundException("커리큘럼을 찾을 수 없습니다."));

        List<Section> sections = sectionRepository.findByCurriculumIdOrderByOrderIndexAsc(curriculumId);
        List<CatalogOutlineSection> outline = buildOutline(sections);
        CatalogInstructor instructor = loadInstructors(List.of(curriculum.getInstructorId()))
                .get(curriculum.getInstructorId());

        String thumbnailUrl = curriculum.getThumbnailAssetId() == null
                ? null
                : assetDirectory.resolveUrl(curriculum.getThumbnailAssetId()).orElse(null);

        return new CatalogDetail(
                curriculum.getId(),
                curriculum.getTitle(),
                curriculum.getSummary(),
                curriculum.getDescription(),
                thumbnailUrl,
                curriculum.getLifecycleStatus().name(),
                curriculum.getStartsAt(),
                curriculum.getEndsAt(),
                instructor,
                outline
        );
    }

    /** 공개 목차: 섹션 순서대로, 각 섹션의 PUBLISHED 레슨만 노출한다. */
    private List<CatalogOutlineSection> buildOutline(List<Section> sections) {
        if (sections.isEmpty()) {
            return List.of();
        }
        List<UUID> sectionIds = sections.stream().map(Section::getId).toList();

        Map<UUID, List<LessonOutlineView>> lessonsBySection =
                lessonDirectory.findPublishedBySections(sectionIds).stream()
                        .collect(Collectors.groupingBy(LessonOutlineView::sectionId));

        return sections.stream().map(section -> new CatalogOutlineSection(
                section.getId(),
                section.getTitle(),
                section.getDescription(),
                section.getOrderIndex(),
                lessonsBySection.getOrDefault(section.getId(), List.of()).stream()
                        .map(l -> new CatalogOutlineLesson(
                                l.lessonId(), l.title(), l.order(), l.status()))
                        .toList()
        )).toList();
    }

    private CatalogCard toCard(Curriculum c, CatalogInstructor instructor, Map<UUID, String> thumbnails) {
        String thumbnailUrl = c.getThumbnailAssetId() == null ? null : thumbnails.get(c.getThumbnailAssetId());
        return new CatalogCard(
                c.getId(),
                c.getTitle(),
                c.getSummary(),
                thumbnailUrl,
                instructor,
                c.getLifecycleStatus().name(),
                c.getStartsAt(),
                c.getEndsAt(),
                c.getSectionCount(),
                c.getLessonCount()
        );
    }

    private Map<UUID, CatalogInstructor> loadInstructors(List<UUID> instructorIds) {
        return instructorDirectory.findSummaries(instructorIds).stream()
                .collect(Collectors.toMap(InstructorSummaryView::instructorId, this::toSummary));
    }

    private CatalogInstructor toSummary(InstructorSummaryView view) {
        return new CatalogInstructor(
                view.instructorId(),
                view.displayName(),
                view.bio(),
                view.expertise());
    }
}
