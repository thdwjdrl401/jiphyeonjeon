package com.liveclass.curriculum.service;

import com.liveclass.asset.api.AssetDirectory;
import com.liveclass.auth.api.InstructorDirectory;
import com.liveclass.auth.api.InstructorSummaryView;
import com.liveclass.curriculum.domain.Curriculum;
import com.liveclass.curriculum.domain.CurriculumLifecycleStatus;
import com.liveclass.curriculum.domain.EnrollmentType;
import com.liveclass.curriculum.domain.Section;
import com.liveclass.curriculum.repository.CurriculumRepository;
import com.liveclass.curriculum.repository.SectionRepository;
import com.liveclass.enrollment.api.EnrollmentDirectory;
import com.liveclass.enrollment.api.EnrollmentStatus;
import com.liveclass.enrollment.api.EnrollmentView;
import com.liveclass.lesson.api.LessonDirectory;
import com.liveclass.lesson.api.LessonOutlineView;
import com.liveclass.live.api.LiveSessionDirectory;
import com.liveclass.live.api.LiveSessionView;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * 공개 커리큘럼 탐색(카탈로그). PUBLISHED만 노출한다.
 * 강사·레슨·수강·라이브 정보는 각 모듈의 포트(InstructorDirectory·LessonDirectory·
 * EnrollmentDirectory·LiveSessionDirectory)로만 얻는다 — 타 모듈 엔티티에 직접 접근하지 않는다
 * (모듈 경계, AGENTS.md).
 * 결과는 서비스 계층 타입({@link CatalogCard}·{@link CatalogDetail})으로 돌려주고 응답 DTO 변환은
 * 컨트롤러가 한다 — 서비스가 web 계층을 참조하지 않도록(InstructorCurriculumService와 동일 방향).
 * 추천(featured)은 범위 밖(후속).
 */
@Service
public class CatalogService {

    /** 라이브 세션이 아직 안 끝났다고 보는 상태 — 이때는 레슨을 열면 라이브 쪽으로 보낸다. */
    private static final Set<String> LIVE_PENDING_STATUSES =
            Set.of("DRAFT", "SCHEDULED", "OPEN", "STARTING");

    private final CurriculumRepository curriculumRepository;
    private final SectionRepository sectionRepository;
    private final LessonDirectory lessonDirectory;
    private final InstructorDirectory instructorDirectory;
    private final AssetDirectory assetDirectory;
    private final EnrollmentDirectory enrollmentDirectory;
    private final LiveSessionDirectory liveSessionDirectory;

    public CatalogService(CurriculumRepository curriculumRepository,
                          SectionRepository sectionRepository,
                          LessonDirectory lessonDirectory,
                          InstructorDirectory instructorDirectory,
                          AssetDirectory assetDirectory,
                          EnrollmentDirectory enrollmentDirectory,
                          LiveSessionDirectory liveSessionDirectory) {
        this.curriculumRepository = curriculumRepository;
        this.sectionRepository = sectionRepository;
        this.lessonDirectory = lessonDirectory;
        this.instructorDirectory = instructorDirectory;
        this.assetDirectory = assetDirectory;
        this.enrollmentDirectory = enrollmentDirectory;
        this.liveSessionDirectory = liveSessionDirectory;
    }

    @Transactional(readOnly = true)
    public Page<CatalogCard> list(String q, CatalogSort sort, int page, int size, CatalogViewer viewer) {
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
        // 내 수강 기록도 커리큘럼마다 묻지 않고 한 번에 받아 커리큘럼별로 정리한다.
        Map<UUID, EnrollmentView> enrollments = loadMyEnrollments(viewer);

        return found.map(c -> toCard(c, instructors.get(c.getInstructorId()), thumbnails,
                viewerContext(c, viewer, enrollments.get(c.getId()))));
    }

    @Transactional(readOnly = true)
    public CatalogDetail detail(UUID curriculumId, CatalogViewer viewer) {
        // PUBLISHED가 아니면 존재를 드러내지 않고 404로 통일한다.
        Curriculum curriculum = curriculumRepository
                .findByIdAndLifecycleStatus(curriculumId, CurriculumLifecycleStatus.PUBLISHED)
                .orElseThrow(() -> new CurriculumNotFoundException("커리큘럼을 찾을 수 없습니다."));

        EnrollmentView enrollment = viewer.isGuest()
                ? null
                : enrollmentDirectory.find(curriculumId, viewer.userId()).orElse(null);
        CatalogViewerContext viewerContext = viewerContext(curriculum, viewer, enrollment);

        List<Section> sections = sectionRepository.findByCurriculumIdOrderByOrderIndexAsc(curriculumId);
        List<CatalogOutlineSection> outline = buildOutline(sections, viewerContext.relationship());
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
                outline,
                enrollmentPolicy(curriculum),
                viewerContext
        );
    }

    /**
     * 내 수강 목록. 수강 기록에 커리큘럼 카드를 붙여서 돌려준다.
     *
     * <p>공개(PUBLISHED) 여부로 거르지 않는다 — 수강 중이던 커리큘럼이 보관(ARCHIVED) 처리돼도
     * 내 목록에서는 계속 보여야 한다. 레코드가 사라진 커리큘럼만 조용히 건너뛴다.
     */
    @Transactional(readOnly = true)
    public List<MyEnrollmentEntry> myEnrollments(CatalogViewer viewer) {
        if (viewer.isGuest()) {
            return List.of();
        }
        List<EnrollmentView> enrollments = enrollmentDirectory.myEnrollments(viewer.userId());
        if (enrollments.isEmpty()) {
            return List.of();
        }

        Map<UUID, Curriculum> curriculums = curriculumRepository
                .findAllById(enrollments.stream().map(EnrollmentView::curriculumId).distinct().toList())
                .stream()
                .collect(Collectors.toMap(Curriculum::getId, c -> c));

        Map<UUID, CatalogInstructor> instructors = loadInstructors(curriculums.values().stream()
                .map(Curriculum::getInstructorId).distinct().toList());
        Map<UUID, String> thumbnails = assetDirectory.resolveUrls(curriculums.values().stream()
                .map(Curriculum::getThumbnailAssetId).filter(Objects::nonNull).toList());

        return enrollments.stream()
                .map(enrollment -> {
                    Curriculum curriculum = curriculums.get(enrollment.curriculumId());
                    if (curriculum == null) {
                        return null;
                    }
                    CatalogCard card = toCard(curriculum, instructors.get(curriculum.getInstructorId()), thumbnails,
                            viewerContext(curriculum, viewer, enrollment));
                    return new MyEnrollmentEntry(enrollment, card);
                })
                .filter(Objects::nonNull)
                .toList();
    }

    /** 공개 목차: 섹션 순서대로, 각 섹션의 PUBLISHED 레슨만 노출한다. */
    private List<CatalogOutlineSection> buildOutline(List<Section> sections, String relationship) {
        if (sections.isEmpty()) {
            return List.of();
        }
        List<UUID> sectionIds = sections.stream().map(Section::getId).toList();

        Map<UUID, List<LessonOutlineView>> lessonsBySection =
                lessonDirectory.findPublishedBySections(sectionIds).stream()
                        .collect(Collectors.groupingBy(LessonOutlineView::sectionId));

        // 레슨마다 라이브 세션을 묻지 않도록 목차 전체분을 한 번에 받아 온다.
        List<UUID> lessonIds = lessonsBySection.values().stream()
                .flatMap(List::stream).map(LessonOutlineView::lessonId).toList();
        Map<UUID, LiveSessionView> liveSessions = liveSessionDirectory.findByLessons(lessonIds).stream()
                .collect(Collectors.toMap(LiveSessionView::lessonId, view -> view, (first, second) -> first));

        return sections.stream().map(section -> new CatalogOutlineSection(
                section.getId(),
                section.getTitle(),
                section.getDescription(),
                section.getOrderIndex(),
                lessonsBySection.getOrDefault(section.getId(), List.of()).stream()
                        .map(l -> toOutlineLesson(l, liveSessions.get(l.lessonId()), relationship))
                        .toList()
        )).toList();
    }

    private CatalogOutlineLesson toOutlineLesson(LessonOutlineView lesson,
                                                 LiveSessionView session,
                                                 String relationship) {
        CatalogLiveSession liveSession = session == null
                ? null
                : new CatalogLiveSession(session.sessionId(), session.liveSessionStatus(), session.scheduledAt());
        // 다시보기 도메인(CP4)이 붙기 전까지 재생 가능한 녹화는 없다.
        String replayStatus = "NOT_READY";

        return new CatalogOutlineLesson(
                lesson.lessonId(),
                lesson.title(),
                lesson.order(),
                lesson.status(),
                liveSession == null ? null : liveSession.scheduledAt(),
                null,
                liveSession,
                replayStatus,
                lessonAccess(lesson, liveSession, replayStatus, relationship),
                null
        );
    }

    /**
     * 레슨을 열 수 있는지와, 열면 어디로 갈지.
     * 목차에 담기는 레슨은 이미 PUBLISHED만 걸러져 있지만, 게시 상태 판정은 여기서 한 번 더 명시한다 —
     * 나중에 강사에게 미게시 레슨까지 보여주게 되어도 규칙이 한 곳에 남도록.
     */
    private CatalogLessonAccess lessonAccess(LessonOutlineView lesson,
                                             CatalogLiveSession liveSession,
                                             String replayStatus,
                                             String relationship) {
        boolean canOpen = "OWNER_INSTRUCTOR".equals(relationship) || "ENROLLED".equals(relationship);
        if (!canOpen) {
            return CatalogLessonAccess.blocked("ENROLLMENT_REQUIRED");
        }
        if ("ENROLLED".equals(relationship) && !"PUBLISHED".equals(lesson.status())) {
            return CatalogLessonAccess.blocked("LESSON_NOT_PUBLISHED");
        }
        return CatalogLessonAccess.open(destination(liveSession, replayStatus));
    }

    private String destination(CatalogLiveSession liveSession, String replayStatus) {
        if (liveSession != null) {
            if ("LIVE".equals(liveSession.status())) {
                return "LIVE_CLASSROOM";
            }
            if (LIVE_PENDING_STATUSES.contains(liveSession.status())) {
                return "LIVE_SESSION";
            }
        }
        if ("PUBLISHED".equals(replayStatus)) {
            return "VOD";
        }
        return "LESSON_DETAIL";
    }

    /**
     * 보는 사람과 커리큘럼의 관계, 그리고 그 관계에서 허용되는 행동.
     * 거절·철회·취소된 수강은 "신청한 적 없음"과 같게 다뤄 다시 신청할 수 있게 둔다.
     */
    private CatalogViewerContext viewerContext(Curriculum curriculum, CatalogViewer viewer, EnrollmentView enrollment) {
        if (viewer.isGuest()) {
            return CatalogViewerContext.of("GUEST", List.of("LOGIN_TO_ENROLL"));
        }
        if (curriculum.getInstructorId().equals(viewer.userId())) {
            return CatalogViewerContext.of("OWNER_INSTRUCTOR", List.of("MANAGE_CURRICULUM", "EDIT_LESSON"));
        }
        if (viewer.instructor()) {
            return CatalogViewerContext.of("NON_OWNER_INSTRUCTOR", List.of());
        }
        if (enrollment != null && enrollment.status() == EnrollmentStatus.ACTIVE) {
            return CatalogViewerContext.of("ENROLLED",
                    List.of("VIEW_LESSON", "CONTINUE_LEARNING", "CANCEL_ENROLLMENT"),
                    toEnrollmentRecord(enrollment));
        }
        if (enrollment != null && enrollment.status() == EnrollmentStatus.PENDING) {
            return CatalogViewerContext.of("PENDING_ENROLLMENT",
                    List.of("CANCEL_ENROLLMENT"),
                    toEnrollmentRecord(enrollment));
        }
        return CatalogViewerContext.of("UNENROLLED_STUDENT", List.of("ENROLL"));
    }

    private CatalogEnrollmentRecord toEnrollmentRecord(EnrollmentView enrollment) {
        return new CatalogEnrollmentRecord(enrollment.id(), enrollment.status().name(), enrollment.requestedAt());
    }

    /** 초대 전용은 카탈로그에서 신청 자체가 불가능하므로 창구를 닫힌 것으로 알린다. */
    private CatalogEnrollmentPolicy enrollmentPolicy(Curriculum curriculum) {
        EnrollmentType type = curriculum.getEnrollmentType();
        String status = type == EnrollmentType.INVITATION_ONLY ? "UNAVAILABLE" : "OPEN";
        return new CatalogEnrollmentPolicy(type.name(), status, null, null);
    }

    private Map<UUID, EnrollmentView> loadMyEnrollments(CatalogViewer viewer) {
        if (viewer.isGuest()) {
            return Map.of();
        }
        return enrollmentDirectory.myEnrollments(viewer.userId()).stream()
                .collect(Collectors.toMap(EnrollmentView::curriculumId, view -> view, (first, second) -> first));
    }

    private CatalogCard toCard(Curriculum c, CatalogInstructor instructor, Map<UUID, String> thumbnails,
                               CatalogViewerContext viewerContext) {
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
                c.getLessonCount(),
                viewerContext
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
