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
import com.liveclass.learning.api.LearningDirectory;
import com.liveclass.learning.api.LearningProgressView;
import com.liveclass.lesson.api.CurriculumMaterialManagement;
import com.liveclass.lesson.api.LessonDetailView;
import com.liveclass.lesson.api.LessonDirectory;
import com.liveclass.lesson.api.LessonMaterialManagement;
import com.liveclass.lesson.api.LessonOutlineView;
import com.liveclass.lesson.api.MaterialView;
import com.liveclass.live.api.LiveSessionDirectory;
import com.liveclass.live.api.LiveSessionView;
import com.liveclass.video.api.ReplayDirectory;
import com.liveclass.video.api.ReplayView;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
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
    private final LessonMaterialManagement lessonMaterialManagement;
    private final CurriculumMaterialManagement curriculumMaterialManagement;
    private final InstructorDirectory instructorDirectory;
    private final AssetDirectory assetDirectory;
    private final EnrollmentDirectory enrollmentDirectory;
    private final LiveSessionDirectory liveSessionDirectory;
    private final ReplayDirectory replayDirectory;
    private final LearningDirectory learningDirectory;

    public CatalogService(CurriculumRepository curriculumRepository,
                          SectionRepository sectionRepository,
                          LessonDirectory lessonDirectory,
                          LessonMaterialManagement lessonMaterialManagement,
                          CurriculumMaterialManagement curriculumMaterialManagement,
                          InstructorDirectory instructorDirectory,
                          AssetDirectory assetDirectory,
                          EnrollmentDirectory enrollmentDirectory,
                          LiveSessionDirectory liveSessionDirectory,
                          ReplayDirectory replayDirectory,
                          LearningDirectory learningDirectory) {
        this.curriculumRepository = curriculumRepository;
        this.sectionRepository = sectionRepository;
        this.lessonDirectory = lessonDirectory;
        this.lessonMaterialManagement = lessonMaterialManagement;
        this.curriculumMaterialManagement = curriculumMaterialManagement;
        this.instructorDirectory = instructorDirectory;
        this.assetDirectory = assetDirectory;
        this.enrollmentDirectory = enrollmentDirectory;
        this.liveSessionDirectory = liveSessionDirectory;
        this.replayDirectory = replayDirectory;
        this.learningDirectory = learningDirectory;
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
        // 수강자면 목차 레슨들의 내 진도를 집계해 progress를 채운다(비수강자는 null 그대로).
        if ("ENROLLED".equals(viewerContext.relationship())) {
            List<UUID> lessonIds = outline.stream().flatMap(s -> s.lessons().stream())
                    .map(CatalogOutlineLesson::lessonId).toList();
            viewerContext = viewerContext.withProgress(computeProgress(viewer.userId(), lessonIds));
        }
        CatalogInstructor instructor = loadInstructors(List.of(curriculum.getInstructorId()))
                .get(curriculum.getInstructorId());

        String thumbnailUrl = curriculum.getThumbnailAssetId() == null
                ? null
                : assetDirectory.resolveUrl(curriculum.getThumbnailAssetId()).orElse(null);

        // 목차 레슨들의 활성 자료를 모아 커리큘럼 단위 materials로 평탄화한다(N+1 회피, ADR-0035).
        // 게스트·미수강자에게는 노출하지 않는다 — progress와 같은 게이트(ENROLLED만)에 OWNER_INSTRUCTOR를
        // 더한 것(강사 자신은 항상 자기 자료를 볼 수 있어야 함). outline은 이미 PUBLISHED 레슨만 담고 있어
        // (buildOutline) 자료도 자연히 공개된 레슨 것만이다.
        // 커리큘럼-레벨 자료(ADR-0042)를 먼저, 그 뒤에 목차 레슨들의 자료를 잇는다 — "커리큘럼 공통"이
        // 위에 오도록. 게이트는 동일(ENROLLED 또는 OWNER_INSTRUCTOR).
        List<MaterialView> materials = List.of();
        String relationship = viewerContext.relationship();
        if ("ENROLLED".equals(relationship) || "OWNER_INSTRUCTOR".equals(relationship)) {
            List<UUID> outlineLessonIds = outline.stream().flatMap(s -> s.lessons().stream())
                    .map(CatalogOutlineLesson::lessonId).toList();
            List<MaterialView> lessonMaterials = lessonMaterialManagement.findActiveByLessons(outlineLessonIds)
                    .values().stream().flatMap(List::stream).toList();
            materials = java.util.stream.Stream.concat(
                    curriculumMaterialManagement.findActiveByCurriculum(curriculumId).stream(),
                    lessonMaterials.stream()).toList();
        }

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
                materials,
                enrollmentPolicy(curriculum),
                viewerContext
        );
    }

    /**
     * 레슨 상세 한 건. 목차의 레슨을 눌러 들어온 화면이 쓴다.
     *
     * <p>공개 목차(detail)는 커리큘럼 단위로 열리지만 이건 레슨 단위라 게이트를 따로 판정한다.
     * 규칙은 목차의 access 판정({@link #lessonAccess})과 같은 것을 쓴다 — 목차에서 열린다고
     * 표시해 놓고 실제로 열면 막히는 어긋남이 생기지 않도록.
     *
     * <ul>
     *   <li>레슨·섹션·커리큘럼이 없으면 404.</li>
     *   <li>소유 강사도 활성 수강생도 아니면 403(존재는 공개 목차로 이미 드러나 있다).</li>
     *   <li>수강생이 미게시 레슨을 찍으면 404 — 그 사람의 목차엔 없는 레슨이므로 존재를 알리지 않는다.</li>
     * </ul>
     */
    @Transactional(readOnly = true)
    public CatalogLessonDetail lessonDetail(UUID lessonId, CatalogViewer viewer) {
        LessonDetailView lesson = lessonDirectory.findDetail(lessonId)
                .orElseThrow(() -> new LessonNotFoundException("레슨을 찾을 수 없습니다."));
        Section section = sectionRepository.findById(lesson.sectionId())
                .orElseThrow(() -> new LessonNotFoundException("레슨을 찾을 수 없습니다."));
        // 보관(ARCHIVED)된 커리큘럼도 막지 않는다 — 듣던 강의는 계속 열려야 한다(myEnrollments와 같은 판단).
        Curriculum curriculum = curriculumRepository.findById(section.getCurriculumId())
                .orElseThrow(() -> new LessonNotFoundException("레슨을 찾을 수 없습니다."));

        EnrollmentView enrollment = viewer.isGuest()
                ? null
                : enrollmentDirectory.find(curriculum.getId(), viewer.userId()).orElse(null);
        String relationship = viewerContext(curriculum, viewer, enrollment).relationship();

        if (!"OWNER_INSTRUCTOR".equals(relationship) && !"ENROLLED".equals(relationship)) {
            throw new LessonAccessDeniedException("이 강의를 수강해야 열 수 있습니다.");
        }
        if ("ENROLLED".equals(relationship) && !"PUBLISHED".equals(lesson.status())) {
            throw new LessonNotFoundException("레슨을 찾을 수 없습니다.");
        }

        return new CatalogLessonDetail(
                lesson.lessonId(),
                lesson.sectionId(),
                curriculum.getId(),
                section.getTitle(),
                curriculum.getTitle(),
                lesson.title(),
                lesson.description(),
                lesson.order(),
                lesson.status(),
                lessonMaterialManagement.findActiveByLesson(lesson.lessonId()));
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
        // 내 수강 목록의 진도를 한 번에 집계한다(커리큘럼마다 조회하지 않도록).
        Map<UUID, CatalogProgress> progressByCurriculum = computeEnrolledProgress(viewer.userId(), curriculums.keySet());

        return enrollments.stream()
                .map(enrollment -> {
                    Curriculum curriculum = curriculums.get(enrollment.curriculumId());
                    if (curriculum == null) {
                        return null;
                    }
                    CatalogViewerContext vc = viewerContext(curriculum, viewer, enrollment);
                    if ("ENROLLED".equals(vc.relationship())) {
                        vc = vc.withProgress(progressByCurriculum.get(curriculum.getId()));
                    }
                    CatalogCard card = toCard(curriculum, instructors.get(curriculum.getInstructorId()), thumbnails, vc);
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
        // 녹화본도 마찬가지. 세션이 레슨당 하나(DDL UNIQUE)라 녹화본도 레슨당 하나지만,
        // 병합 함수를 둬서 혹시 모를 중복에 첫 건을 택한다.
        Map<UUID, ReplayView> replays = replayDirectory.findByLessons(lessonIds).stream()
                .collect(Collectors.toMap(ReplayView::lessonId, view -> view, (first, second) -> first));

        return sections.stream().map(section -> new CatalogOutlineSection(
                section.getId(),
                section.getTitle(),
                section.getDescription(),
                section.getOrderIndex(),
                lessonsBySection.getOrDefault(section.getId(), List.of()).stream()
                        .map(l -> toOutlineLesson(l, liveSessions.get(l.lessonId()), replays.get(l.lessonId()), relationship))
                        .toList()
        )).toList();
    }

    private CatalogOutlineLesson toOutlineLesson(LessonOutlineView lesson,
                                                 LiveSessionView session,
                                                 ReplayView replay,
                                                 String relationship) {
        CatalogLiveSession liveSession = session == null
                ? null
                : new CatalogLiveSession(session.sessionId(), session.liveSessionStatus(), session.scheduledAt());
        // 녹화 자체가 없는 레슨은 NOT_READY. 녹화가 있으면 그 상태를 그대로 옮긴다(라이브를 한 번 한
        // 레슨은 DRAFT로 잡힌다). 게시 검수 흐름이 아직 없어 PUBLISHED에는 도달하지 않는다.
        String replayStatus = replay == null ? "NOT_READY" : replay.replayStatus();
        // 재생 길이는 녹화 완료 webhook이 채운다 — 그 경로 전까지는 녹화가 있어도 null이다.
        Long durationMs = replay == null ? null : replay.durationMs();

        return new CatalogOutlineLesson(
                lesson.lessonId(),
                lesson.title(),
                lesson.order(),
                lesson.status(),
                liveSession == null ? null : liveSession.scheduledAt(),
                durationMs,
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
        // 신청이 실제로 통과할 때만 ENROLL을 준다. FE는 이 목록만 보고 버튼을 켜므로(EnrollmentActions),
        // 여기서 무조건 주면 초대 전용·모집 마감 커리큘럼에서 버튼이 켜진 채 409로 떨어진다.
        return CatalogViewerContext.of("UNENROLLED_STUDENT",
                enrollmentPolicy(curriculum).isOpen() ? List.of("ENROLL") : List.of());
    }

    /**
     * 학생 학습 요약(대시보드). 활성 수강들의 진도를 {@link #computeEnrolledProgress}로 한 번에 집계하고
     * 커리큘럼 수·평균·완료 레슨 수로 접는다. 다음 라이브는 {@link #nearestLiveSession}로 붙인다.
     * 비로그인·수강 없음이면 빈 요약.
     */
    @Transactional(readOnly = true)
    public StudentLearningSummary studentLearningSummary(CatalogViewer viewer) {
        if (viewer.isGuest()) {
            return StudentLearningSummary.empty();
        }
        List<UUID> curriculumIds = enrollmentDirectory.myEnrollments(viewer.userId()).stream()
                .filter(e -> e.status() == EnrollmentStatus.ACTIVE)
                .map(EnrollmentView::curriculumId)
                .distinct()
                .toList();
        if (curriculumIds.isEmpty()) {
            return StudentLearningSummary.empty();
        }

        Map<UUID, CatalogProgress> progressByCurriculum = computeEnrolledProgress(viewer.userId(), curriculumIds);
        int completedCurriculums = 0;
        int completedLessons = 0;
        int percentSum = 0;
        for (UUID curriculumId : curriculumIds) {
            CatalogProgress p = progressByCurriculum.get(curriculumId);
            if (p == null) {
                continue;   // 게시 레슨이 없는 커리큘럼 — 진도 0으로 취급(평균 분모에는 포함)
            }
            completedLessons += p.completedLessonCount();
            percentSum += p.progressPercent();
            if (p.totalLessonCount() > 0 && p.progressPercent() >= 100) {
                completedCurriculums++;
            }
        }
        int enrolled = curriculumIds.size();
        int averageProgress = Math.round((float) percentSum / enrolled);
        return new StudentLearningSummary(
                enrolled - completedCurriculums, completedCurriculums, averageProgress, completedLessons,
                nearestLiveSession(curriculumIds));
    }

    /**
     * 강사 대시보드 요약(내 커리큘럼 상단). 내 커리큘럼 전반의 운영 지표를 집계한다.
     * 비로그인·비강사면 빈 요약. 라이브 다음 세션은 학생 요약과 같은 조립 로직을 재사용한다.
     */
    @Transactional(readOnly = true)
    public InstructorDashboardSummary instructorDashboardSummary(CatalogViewer viewer) {
        if (viewer.isGuest() || !viewer.instructor()) {
            return InstructorDashboardSummary.empty();
        }
        List<Curriculum> mine = curriculumRepository.findByInstructorId(viewer.userId());
        if (mine.isEmpty()) {
            return InstructorDashboardSummary.empty();
        }
        List<UUID> ids = mine.stream().map(Curriculum::getId).toList();
        int published = (int) mine.stream()
                .filter(c -> c.getLifecycleStatus() == CurriculumLifecycleStatus.PUBLISHED).count();
        // 예정/진행 세션·수강생 합은 각각 한 번의 배치 조회로(커리큘럼당 반복하면 N+1).
        Map<UUID, LiveSessionView> nextSessions = liveSessionDirectory.nextScheduledByCurriculum(ids);
        long enrollees = enrollmentDirectory.countActiveByCurriculums(ids).values().stream()
                .mapToLong(Long::longValue).sum();
        return new InstructorDashboardSummary(
                mine.size(), published, nextSessions.size(), enrollees, nearestLiveSession(nextSessions));
    }

    /** 수강 커리큘럼들 중 가장 이른 예정/진행 라이브 하나를 대시보드용으로 조립한다(없으면 null). */
    private StudentLearningSummary.TodayLiveSession nearestLiveSession(List<UUID> curriculumIds) {
        return nearestLiveSession(liveSessionDirectory.nextScheduledByCurriculum(curriculumIds));
    }

    /** 이미 조회한 "커리큘럼별 다음 세션" 맵에서 가장 이른 하나를 조립한다(중복 조회 회피). */
    private StudentLearningSummary.TodayLiveSession nearestLiveSession(Map<UUID, LiveSessionView> nextByCurriculum) {
        Map.Entry<UUID, LiveSessionView> nearest = nextByCurriculum
                .entrySet().stream()
                .filter(e -> e.getValue() != null && e.getValue().scheduledAt() != null)
                .min(Comparator.comparing(e -> e.getValue().scheduledAt()))
                .orElse(null);
        if (nearest == null) {
            return null;
        }
        UUID curriculumId = nearest.getKey();
        LiveSessionView session = nearest.getValue();
        String curriculumTitle = curriculumRepository.findById(curriculumId)
                .map(Curriculum::getTitle).orElse(null);
        String lessonTitle = lessonDirectory.findTitles(List.of(session.lessonId())).get(session.lessonId());
        return new StudentLearningSummary.TodayLiveSession(
                session.sessionId(), session.lessonId(), lessonTitle,
                curriculumId, curriculumTitle, null,
                session.scheduledAt(), session.liveSessionStatus(), null);
    }

    /**
     * 한 커리큘럼의 내 진도(단건 조회). 완료 레슨 수 기준 — completedLessonCount / totalLessonCount.
     * lastLearning은 가장 최근에 갱신한 진도의 레슨·위치.
     */
    private CatalogProgress computeProgress(UUID userId, List<UUID> lessonIds) {
        if (lessonIds.isEmpty()) {
            return new CatalogProgress(0, 0, 0, null);
        }
        Map<UUID, LearningProgressView> byLesson = learningDirectory.findProgress(userId, lessonIds).stream()
                .collect(Collectors.toMap(LearningProgressView::lessonId, p -> p));
        return progressFrom(lessonIds, byLesson);
    }

    /**
     * 내 수강 목록 전체의 진도를 커리큘럼별로 <b>한 번에</b> 집계한다(N+1 방지):
     * 섹션·게시레슨·진도를 각각 IN 쿼리 한 번씩만 친다.
     */
    private Map<UUID, CatalogProgress> computeEnrolledProgress(UUID userId, java.util.Collection<UUID> curriculumIds) {
        List<Section> sections = sectionRepository.findByCurriculumIdIn(curriculumIds);
        if (sections.isEmpty()) {
            return Map.of();
        }
        Map<UUID, UUID> sectionToCurriculum = sections.stream()
                .collect(Collectors.toMap(Section::getId, Section::getCurriculumId));
        List<UUID> sectionIds = sections.stream().map(Section::getId).toList();

        Map<UUID, List<UUID>> lessonsByCurriculum = new HashMap<>();
        for (LessonOutlineView lesson : lessonDirectory.findPublishedBySections(sectionIds)) {
            UUID curriculumId = sectionToCurriculum.get(lesson.sectionId());
            if (curriculumId != null) {
                lessonsByCurriculum.computeIfAbsent(curriculumId, k -> new ArrayList<>()).add(lesson.lessonId());
            }
        }
        List<UUID> allLessonIds = lessonsByCurriculum.values().stream().flatMap(List::stream).toList();
        Map<UUID, LearningProgressView> byLesson = allLessonIds.isEmpty() ? Map.of()
                : learningDirectory.findProgress(userId, allLessonIds).stream()
                        .collect(Collectors.toMap(LearningProgressView::lessonId, p -> p));

        Map<UUID, CatalogProgress> result = new HashMap<>();
        lessonsByCurriculum.forEach((curriculumId, lessonIds) ->
                result.put(curriculumId, progressFrom(lessonIds, byLesson)));
        return result;
    }

    /** 레슨 목록과 진도 맵에서 완료율·마지막 학습 지점을 계산한다. */
    private CatalogProgress progressFrom(List<UUID> lessonIds, Map<UUID, LearningProgressView> byLesson) {
        int total = lessonIds.size();
        if (total == 0) {
            return new CatalogProgress(0, 0, 0, null);
        }
        List<LearningProgressView> mine = lessonIds.stream().map(byLesson::get).filter(Objects::nonNull).toList();
        int completed = (int) mine.stream().filter(LearningProgressView::completed).count();
        int percent = (int) Math.round(completed * 100.0 / total);
        LearningProgressView last = mine.stream()
                .filter(p -> p.updatedAt() != null)
                .max(Comparator.comparing(LearningProgressView::updatedAt))
                .orElse(null);
        CatalogProgress.CatalogLastLearning lastLearning = last == null ? null
                : new CatalogProgress.CatalogLastLearning(
                        last.lessonId(), last.lastPositionMs() == null ? 0L : last.lastPositionMs());
        return new CatalogProgress(completed, total, percent, lastLearning);
    }

    private CatalogEnrollmentRecord toEnrollmentRecord(EnrollmentView enrollment) {
        return new CatalogEnrollmentRecord(enrollment.id(), enrollment.status().name(), enrollment.requestedAt());
    }

    /**
     * 지금 신청을 받는가. 판정 조건은 실제 신청 API({@code CurriculumEnrollmentService#apply})의
     * 전제조건과 같아야 한다 — 여기서 OPEN이라고 답해 놓고 신청에서 409를 던지면 버튼이 거짓말을 한다.
     */
    private CatalogEnrollmentPolicy enrollmentPolicy(Curriculum curriculum) {
        EnrollmentType type = curriculum.getEnrollmentType();
        OffsetDateTime opensAt = curriculum.getEnrollmentOpensAt();
        OffsetDateTime closesAt = curriculum.getEnrollmentClosesAt();
        OffsetDateTime now = OffsetDateTime.now();

        String status;
        if (type == EnrollmentType.INVITATION_ONLY
                || curriculum.getLifecycleStatus() != CurriculumLifecycleStatus.PUBLISHED) {
            status = "UNAVAILABLE";       // 초대 전용이거나 아직 공개되지 않음 — 창구 일정과 무관하게 불가
        } else if (opensAt != null && now.isBefore(opensAt)) {
            status = "NOT_OPEN";          // 모집 시작 전
        } else if (closesAt != null && now.isAfter(closesAt)) {
            status = "CLOSED";            // 모집 마감
        } else {
            status = "OPEN";
        }
        return new CatalogEnrollmentPolicy(type.name(), status, opensAt, closesAt);
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
