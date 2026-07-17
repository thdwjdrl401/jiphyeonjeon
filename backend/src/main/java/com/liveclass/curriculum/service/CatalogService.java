package com.liveclass.curriculum.service;

import com.liveclass.auth.domain.AppUser;
import com.liveclass.auth.domain.InstructorProfile;
import com.liveclass.auth.repository.AppUserRepository;
import com.liveclass.auth.repository.InstructorProfileRepository;
import com.liveclass.curriculum.domain.Curriculum;
import com.liveclass.curriculum.domain.CurriculumLifecycleStatus;
import com.liveclass.curriculum.domain.Section;
import com.liveclass.curriculum.repository.CurriculumRepository;
import com.liveclass.curriculum.repository.SectionRepository;
import com.liveclass.curriculum.web.dto.CurriculumCardSummary;
import com.liveclass.curriculum.web.dto.CurriculumDetailResponse;
import com.liveclass.curriculum.web.dto.CurriculumPeriod;
import com.liveclass.curriculum.web.dto.InstructorSummary;
import com.liveclass.curriculum.web.dto.OutlineLesson;
import com.liveclass.curriculum.web.dto.OutlineSection;
import com.liveclass.lesson.domain.Lesson;
import com.liveclass.lesson.domain.LessonStatus;
import com.liveclass.lesson.repository.LessonRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * 공개 커리큘럼 탐색(카탈로그). PUBLISHED만 노출한다.
 * viewerContext·수강정책·추천(featured)·썸네일 해석은 범위 밖(후속).
 */
@Service
public class CatalogService {

    private final CurriculumRepository curriculumRepository;
    private final SectionRepository sectionRepository;
    private final LessonRepository lessonRepository;
    private final AppUserRepository appUserRepository;
    private final InstructorProfileRepository instructorProfileRepository;

    public CatalogService(CurriculumRepository curriculumRepository,
                          SectionRepository sectionRepository,
                          LessonRepository lessonRepository,
                          AppUserRepository appUserRepository,
                          InstructorProfileRepository instructorProfileRepository) {
        this.curriculumRepository = curriculumRepository;
        this.sectionRepository = sectionRepository;
        this.lessonRepository = lessonRepository;
        this.appUserRepository = appUserRepository;
        this.instructorProfileRepository = instructorProfileRepository;
    }

    @Transactional(readOnly = true)
    public Page<CurriculumCardSummary> list(String q, CatalogSort sort, int page, int size) {
        Pageable pageable = PageRequest.of(page, size, sort.toSort());
        String normalizedQuery = (q == null || q.isBlank()) ? null : q.trim();

        Page<Curriculum> found = (normalizedQuery == null)
                ? curriculumRepository.findByLifecycleStatus(CurriculumLifecycleStatus.PUBLISHED, pageable)
                : curriculumRepository.searchPublic(CurriculumLifecycleStatus.PUBLISHED, normalizedQuery, pageable);

        // 강사 정보를 카드마다 조회하면 N+1이라 한 번에 모아 맵으로 만든다.
        Map<UUID, InstructorSummary> instructors = loadInstructors(
                found.getContent().stream().map(Curriculum::getInstructorId).distinct().toList());

        return found.map(c -> toCard(c, instructors.get(c.getInstructorId())));
    }

    @Transactional(readOnly = true)
    public CurriculumDetailResponse detail(UUID curriculumId) {
        // PUBLISHED가 아니면 존재를 드러내지 않고 404로 통일한다.
        Curriculum curriculum = curriculumRepository
                .findByIdAndLifecycleStatus(curriculumId, CurriculumLifecycleStatus.PUBLISHED)
                .orElseThrow(() -> new CurriculumNotFoundException("커리큘럼을 찾을 수 없습니다."));

        List<Section> sections = sectionRepository.findByCurriculumIdOrderByOrderIndexAsc(curriculumId);
        List<OutlineSection> outline = buildOutline(sections);
        InstructorSummary instructor = loadInstructors(List.of(curriculum.getInstructorId()))
                .get(curriculum.getInstructorId());

        return new CurriculumDetailResponse(
                curriculum.getId().toString(),
                curriculum.getTitle(),
                curriculum.getSummary(),
                curriculum.getDescription(),
                null, // 썸네일 URL 해석은 후속(asset 스토리지 seam)
                curriculum.getLifecycleStatus().name(),
                CurriculumPeriod.of(curriculum.getStartsAt(), curriculum.getEndsAt()),
                instructor,
                outline
        );
    }

    /** 공개 목차: 섹션 순서대로, 각 섹션의 PUBLISHED 레슨만 노출한다. */
    private List<OutlineSection> buildOutline(List<Section> sections) {
        if (sections.isEmpty()) {
            return List.of();
        }
        List<UUID> sectionIds = sections.stream().map(Section::getId).toList();

        Map<UUID, List<Lesson>> lessonsBySection = lessonRepository
                .findBySectionIdInAndStatusOrderByOrderIndexAsc(sectionIds, LessonStatus.PUBLISHED)
                .stream()
                .collect(Collectors.groupingBy(Lesson::getSectionId));

        return sections.stream().map(section -> new OutlineSection(
                section.getId().toString(),
                section.getTitle(),
                section.getDescription(),
                section.getOrderIndex(),
                lessonsBySection.getOrDefault(section.getId(), List.of()).stream()
                        .map(l -> new OutlineLesson(
                                l.getId().toString(), l.getTitle(), l.getOrderIndex(), l.getStatus().name()))
                        .toList()
        )).toList();
    }

    private CurriculumCardSummary toCard(Curriculum c, InstructorSummary instructor) {
        return new CurriculumCardSummary(
                c.getId().toString(),
                c.getTitle(),
                c.getSummary(),
                null, // 썸네일 URL 해석은 후속
                instructor,
                c.getLifecycleStatus().name(),
                CurriculumPeriod.of(c.getStartsAt(), c.getEndsAt()),
                c.getSectionCount(),
                c.getLessonCount()
        );
    }

    private Map<UUID, InstructorSummary> loadInstructors(List<UUID> instructorIds) {
        if (instructorIds.isEmpty()) {
            return Map.of();
        }
        Map<UUID, String> displayNames = appUserRepository.findAllById(instructorIds).stream()
                .collect(Collectors.toMap(AppUser::getId, AppUser::getDisplayName));
        Map<UUID, InstructorProfile> profiles = instructorProfileRepository.findAllById(instructorIds).stream()
                .collect(Collectors.toMap(InstructorProfile::getUserId, Function.identity()));

        return instructorIds.stream().collect(Collectors.toMap(Function.identity(), id -> {
            InstructorProfile profile = profiles.get(id);
            return new InstructorSummary(
                    id.toString(),
                    displayNames.get(id),
                    profile != null ? profile.getBio() : null,
                    profile != null ? profile.getExpertise() : List.of());
        }));
    }
}
