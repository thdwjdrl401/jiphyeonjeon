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
import com.liveclass.video.api.RecordedDeliveryView;
import com.liveclass.video.api.RecordedVideoDirectory;
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
 * 공개 커리큘럼 탐색(카탈로그). 커리큘럼 lifecycleStatus=PUBLISHED만 노출한다 — 레슨 상태는 보지 않는다(ADR-0005).
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
    private final RecordedVideoDirectory recordedVideoDirectory;
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
                          RecordedVideoDirectory recordedVideoDirectory,
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
        this.recordedVideoDirectory = recordedVideoDirectory;
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
        // PUBLISHED가 아니면 존재를 드러내지 않고 404로 통일한다 — 단 소유 강사는 예외다.
        //
        // 이 상세는 강사도 본다. 관리 화면의 "커리큘럼 상세" 버튼이 여기로 오고, 강사는 공개 전에
        // 자기 커리큘럼이 수강생에게 어떻게 보이는지 확인해야 한다. 소유자까지 404로 막으면 초안
        // 커리큘럼은 만든 사람조차 미리 볼 수 없다 — 실제로 그 상태였다.
        //
        // 남에게는 그대로 404다. 403으로 돌려주면 "여기 뭔가 있다"는 사실이 드러난다.
        Curriculum curriculum = curriculumRepository.findById(curriculumId)
                .filter(found -> found.getLifecycleStatus() == CurriculumLifecycleStatus.PUBLISHED
                        || isOwner(found, viewer))
                .orElseThrow(() -> new CurriculumNotFoundException("커리큘럼을 찾을 수 없습니다."));

        EnrollmentView enrollment = viewer.isGuest()
                ? null
                : enrollmentDirectory.find(curriculumId, viewer.userId()).orElse(null);
        CatalogViewerContext viewerContext = viewerContext(curriculum, viewer, enrollment);

        List<Section> sections = sectionRepository.findByCurriculumIdOrderByOrderIndexAsc(curriculumId);
        List<CatalogOutlineSection> outline = buildOutline(sections, viewerContext.relationship());
        /*
         * 수강자면 목차 레슨들의 내 진도를 <b>한 번 조회해 두 곳에</b> 쓴다(비수강자는 null 그대로).
         *
         * <p>커리큘럼 progress는 "몇 강을 끝냈나"만 말하므로, 목차에서 <b>어느</b> 강의를 끝냈는지는
         * 레슨별 learning이 있어야 보인다. 예전에는 여기서 progress만 채우고 레슨별 learning은
         * null로 두어, 진행률 막대는 움직이는데 목차의 완료 표시는 늘 비어 있었다. 같은 조회
         * 결과로 둘 다 채운다 — 쿼리는 늘지 않는다.
         */
        if ("ENROLLED".equals(viewerContext.relationship())) {
            List<UUID> lessonIds = outline.stream().flatMap(s -> s.lessons().stream())
                    .map(CatalogOutlineLesson::lessonId).toList();
            Map<UUID, LearningProgressView> byLesson = findProgressByLesson(viewer.userId(), lessonIds);
            viewerContext = viewerContext.withProgress(progressFrom(lessonIds, byLesson));
            outline = withLearning(outline, byLesson);
        }
        CatalogInstructor instructor = loadInstructors(List.of(curriculum.getInstructorId()))
                .get(curriculum.getInstructorId());

        String thumbnailUrl = curriculum.getThumbnailAssetId() == null
                ? null
                : assetDirectory.resolveUrl(curriculum.getThumbnailAssetId()).orElse(null);

        /*
         * <b>커리큘럼-레벨 자료만</b> 담는다(ADR-0042). 레슨 자료는 여기 오지 않는다.
         *
         * <p>예전에는 목차 레슨들의 자료까지 이어 붙여 한 배열로 내려보냈다. 그런데 이 목록을 그리는
         * 화면은 스스로 "전체 강의에서 공통으로 사용하는 자료입니다"라고 말하고 있어, <b>약속한 것과
         * 주는 것이 달랐다.</b> 응답에 커리큘럼 것인지 레슨 것인지 구분할 필드도 없어 화면이 갈라
         * 낼 수도 없었다.
         *
         * <p>레슨 자료는 레슨 상세가 이미 준다({@code LessonDetailResponse.materials}) — 거기서
         * 그 레슨의 것으로 보이는 편이 맞고, 여기 섞으면 어느 강의 자료인지 알 수 없는 목록이 된다.
         *
         * <p>게스트·미수강자에게는 노출하지 않는다 — progress와 같은 게이트(ENROLLED만)에
         * OWNER_INSTRUCTOR를 더한 것(강사 자신은 항상 자기 자료를 볼 수 있어야 함).
         */
        List<MaterialView> materials = List.of();
        String relationship = viewerContext.relationship();
        if ("ENROLLED".equals(relationship) || "OWNER_INSTRUCTOR".equals(relationship)) {
            materials = curriculumMaterialManagement.findActiveByCurriculum(curriculumId);
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
        if ("RECORDED".equals(lesson.deliveryType())
                && !"OWNER_INSTRUCTOR".equals(relationship)
                && recordedVideoDirectory.findByLesson(lessonId)
                        .filter(delivery -> "PUBLISHED".equals(delivery.publicationStatus()))
                        .isEmpty()) {
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
                lesson.deliveryType(),
                lessonMaterialManagement.findActiveByLesson(lesson.lessonId()));
    }

    /**
     * 수강생 레슨 자료 다운로드 URL. 레슨 상세와 같은 접근 판정을 먼저 통과시킨 뒤, 요청한 자료가
     * 그 레슨에 활성 상태로 연결돼 있을 때만 presigned URL을 발급한다.
     */
    @Transactional(readOnly = true)
    public String lessonMaterialDownloadUrl(UUID lessonId, UUID materialId, CatalogViewer viewer) {
        CatalogLessonDetail lesson = lessonDetail(lessonId, viewer);
        MaterialView material = lesson.materials().stream()
                .filter(candidate -> candidate.materialId().equals(materialId))
                .findFirst()
                .orElseThrow(() -> new LessonNotFoundException("자료를 찾을 수 없습니다."));
        return assetDirectory.resolveUrl(material.assetId())
                .orElseThrow(() -> new LessonNotFoundException("자료 URL을 발급할 수 없습니다."));
    }

    /**
     * 수강생 커리큘럼 자료 다운로드 URL. 공개 상세를 볼 수 있다는 사실만으로는 부족하며,
     * ACTIVE 수강 관계(ENROLLED)인지 다시 확인한 뒤 해당 커리큘럼의 활성 자료만 허용한다.
     */
    @Transactional(readOnly = true)
    public String curriculumMaterialDownloadUrl(UUID curriculumId, UUID materialId, CatalogViewer viewer) {
        CatalogDetail curriculum = detail(curriculumId, viewer);
        if (!"ENROLLED".equals(curriculum.viewerContext().relationship())) {
            throw new LessonAccessDeniedException("이 커리큘럼을 수강해야 자료를 다운로드할 수 있습니다.");
        }
        MaterialView material = curriculum.materials().stream()
                .filter(candidate -> candidate.materialId().equals(materialId))
                .findFirst()
                .orElseThrow(() -> new CurriculumNotFoundException("자료를 찾을 수 없습니다."));
        return assetDirectory.resolveUrl(material.assetId())
                .orElseThrow(() -> new CurriculumNotFoundException("자료 URL을 발급할 수 없습니다."));
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

    /**
     * 공개 목차: 섹션 순서대로 레슨을 노출하되 학생에게는 아직 게시되지 않은 업로드 녹화강의를 숨긴다.
     *
     * <p>lesson 상태로는 거르지 않는다 — 레슨에는 초안이 없고 공개 여부는 커리큘럼 lifecycleStatus가
     * 소유한다(ADR-0005). 단, RECORDED delivery는 별도 재생 패키지 게시 게이트(ADR-0012)를 통과해야
     * 학생이 열 수 있으며 소유 강사의 관리 목차에는 처리 중인 항목도 유지한다.
     */
    private List<CatalogOutlineSection> buildOutline(List<Section> sections, String relationship) {
        if (sections.isEmpty()) {
            return List.of();
        }
        List<UUID> sectionIds = sections.stream().map(Section::getId).toList();

        Map<UUID, List<LessonOutlineView>> lessonsBySection =
                lessonDirectory.findBySections(sectionIds).stream()
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
        Map<UUID, RecordedDeliveryView> recordedDeliveries = recordedVideoDirectory.findByLessons(lessonIds).stream()
                .collect(Collectors.toMap(RecordedDeliveryView::lessonId, view -> view, (first, second) -> first));

        return sections.stream().map(section -> new CatalogOutlineSection(
                section.getId(),
                section.getTitle(),
                section.getDescription(),
                section.getOrderIndex(),
                lessonsBySection.getOrDefault(section.getId(), List.of()).stream()
                        .filter(lesson -> exposeInOutline(lesson, recordedDeliveries.get(lesson.lessonId()), relationship))
                        .map(l -> toOutlineLesson(l, liveSessions.get(l.lessonId()), replays.get(l.lessonId()),
                                recordedDeliveries.get(l.lessonId()), relationship))
                        .toList()
        )).toList();
    }

    private CatalogOutlineLesson toOutlineLesson(LessonOutlineView lesson,
                                                 LiveSessionView session,
                                                 ReplayView replay,
                                                 RecordedDeliveryView recordedDelivery,
                                                 String relationship) {
        CatalogLiveSession liveSession = session == null
                ? null
                : new CatalogLiveSession(session.sessionId(), session.liveSessionStatus(), session.scheduledAt());
        // 녹화 자체가 없는 레슨은 NOT_READY. 녹화가 있으면 그 상태를 그대로 옮긴다(라이브를 한 번 한
        // 레슨은 DRAFT로 잡힌다). 게시 검수 흐름이 아직 없어 PUBLISHED에는 도달하지 않는다.
        String replayStatus = replay == null ? "NOT_READY" : replay.replayStatus();
        // 재생 길이는 녹화 완료 webhook이 채운다 — 그 경로 전까지는 녹화가 있어도 null이다.
        Long durationMs = "RECORDED".equals(lesson.deliveryType())
                ? recordedDelivery == null ? null : recordedDelivery.durationMs()
                : replay == null ? null : replay.durationMs();
        String recordedPublicationStatus = recordedDelivery == null ? null : recordedDelivery.publicationStatus();

        return new CatalogOutlineLesson(
                lesson.lessonId(),
                lesson.title(),
                lesson.order(),
                lesson.status(),
                lesson.deliveryType(),
                liveSession == null ? null : liveSession.scheduledAt(),
                durationMs,
                liveSession,
                replayStatus,
                recordedPublicationStatus,
                lessonAccess(lesson.deliveryType(), liveSession, replayStatus,
                        recordedPublicationStatus, relationship),
                null
        );
    }

    private boolean exposeInOutline(LessonOutlineView lesson,
                                    RecordedDeliveryView recordedDelivery,
                                    String relationship) {
        if (!"RECORDED".equals(lesson.deliveryType()) || "OWNER_INSTRUCTOR".equals(relationship)) {
            return true;
        }
        return recordedDelivery != null && "PUBLISHED".equals(recordedDelivery.publicationStatus());
    }

    /**
     * 레슨을 열 수 있는지와, 열면 어디로 갈지.
     * 판정 축은 <b>관계 하나</b>다 — 레슨 상태로는 막지 않는다(ADR-0005). 커리큘럼이 공개됐다면
     * 그 안의 레슨은 수강생에게 전부 열린다.
     */
    private CatalogLessonAccess lessonAccess(String deliveryType,
                                             CatalogLiveSession liveSession,
                                             String replayStatus,
                                             String recordedPublicationStatus,
                                             String relationship) {
        boolean canOpen = "OWNER_INSTRUCTOR".equals(relationship) || "ENROLLED".equals(relationship);
        if (!canOpen) {
            return CatalogLessonAccess.blocked("ENROLLMENT_REQUIRED");
        }
        if ("RECORDED".equals(deliveryType)) {
            return CatalogLessonAccess.open("PUBLISHED".equals(recordedPublicationStatus)
                    ? "RECORDED_VOD"
                    : "LESSON_DETAIL");
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
    /**
     * 이 커리큘럼을 만든 강사인가. 공개 전 상세를 볼 수 있는지와 관계(OWNER_INSTRUCTOR) 판정이
     * 같은 규칙을 쓰도록 한 곳에 둔다 — 갈라지면 "볼 수는 있는데 관리 버튼은 없는" 화면이 나온다.
     */
    private boolean isOwner(Curriculum curriculum, CatalogViewer viewer) {
        return !viewer.isGuest() && curriculum.getInstructorId().equals(viewer.userId());
    }

    private CatalogViewerContext viewerContext(Curriculum curriculum, CatalogViewer viewer, EnrollmentView enrollment) {
        if (viewer.isGuest()) {
            return CatalogViewerContext.of("GUEST", List.of("LOGIN_TO_ENROLL"));
        }
        if (isOwner(curriculum, viewer)) {
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
    private StudentLearningSummary.UpcomingLiveSession nearestLiveSession(List<UUID> curriculumIds) {
        return nearestLiveSession(liveSessionDirectory.nextScheduledByCurriculum(curriculumIds));
    }

    /** 이미 조회한 "커리큘럼별 다음 세션" 맵에서 가장 이른 하나를 조립한다(중복 조회 회피). */
    private StudentLearningSummary.UpcomingLiveSession nearestLiveSession(Map<UUID, LiveSessionView> nextByCurriculum) {
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
        return new StudentLearningSummary.UpcomingLiveSession(
                session.sessionId(), session.lessonId(), lessonTitle,
                curriculumId, curriculumTitle, null,
                session.scheduledAt(), session.liveSessionStatus(), null);
    }

    /**
     * 내 진도를 레슨별로 한 번에 조회한다(단건 커리큘럼용). 진도 기록이 없는 레슨은 맵에 없다 —
     * 호출자가 "아직 안 본 강의"로 다룬다.
     */
    private Map<UUID, LearningProgressView> findProgressByLesson(UUID userId, List<UUID> lessonIds) {
        if (lessonIds.isEmpty()) {
            return Map.of();
        }
        return learningDirectory.findProgress(userId, lessonIds).stream()
                .collect(Collectors.toMap(LearningProgressView::lessonId, p -> p));
    }

    /**
     * 목차 레슨에 내 학습 상태를 얹는다. 진도 기록이 없는 레슨은 <b>null 그대로</b> 둔다 —
     * "0%"와 "아직 안 본 강의"는 다르고, 화면이 그 둘을 갈라 그릴 수 있어야 한다.
     */
    private static List<CatalogOutlineSection> withLearning(List<CatalogOutlineSection> outline,
                                                            Map<UUID, LearningProgressView> byLesson) {
        if (byLesson.isEmpty()) {
            return outline;
        }
        return outline.stream()
                .map(section -> new CatalogOutlineSection(
                        section.sectionId(), section.title(), section.description(), section.order(),
                        section.lessons().stream().map(lesson -> {
                            LearningProgressView mine = byLesson.get(lesson.lessonId());
                            return mine == null ? lesson : lesson.withLearning(
                                    new CatalogLessonLearning(mine.completed(), mine.progressPercent()));
                        }).toList()))
                .toList();
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

        List<LessonOutlineView> lessons = lessonDirectory.findBySections(sectionIds);
        List<UUID> recordedLessonIds = lessons.stream()
                .filter(lesson -> "RECORDED".equals(lesson.deliveryType()))
                .map(LessonOutlineView::lessonId)
                .toList();
        Set<UUID> publishedRecordedLessonIds = recordedVideoDirectory.findByLessons(recordedLessonIds).stream()
                .filter(delivery -> "PUBLISHED".equals(delivery.publicationStatus()))
                .map(RecordedDeliveryView::lessonId)
                .collect(Collectors.toSet());

        Map<UUID, List<UUID>> lessonsByCurriculum = new HashMap<>();
        for (LessonOutlineView lesson : lessons) {
            if ("RECORDED".equals(lesson.deliveryType())
                    && !publishedRecordedLessonIds.contains(lesson.lessonId())) {
                continue;
            }
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
