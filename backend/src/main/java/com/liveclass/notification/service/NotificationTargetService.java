package com.liveclass.notification.service;

import com.liveclass.curriculum.api.CurriculumDirectory;
import com.liveclass.curriculum.api.CurriculumView;
import com.liveclass.enrollment.api.EnrollmentDirectory;
import com.liveclass.lesson.api.LessonDetailView;
import com.liveclass.lesson.api.LessonDirectory;
import com.liveclass.live.api.LiveSessionDirectory;
import com.liveclass.live.api.LiveSessionView;
import com.liveclass.notification.domain.Notification;
import com.liveclass.notification.domain.NotificationStatus;
import com.liveclass.notification.repository.NotificationRepository;
import com.liveclass.video.api.ReplayDirectory;
import com.liveclass.video.api.ReplayView;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static com.liveclass.notification.service.NotificationTargetResolution.Available;
import static com.liveclass.notification.service.NotificationTargetResolution.Gone;
import static com.liveclass.notification.service.NotificationTargetResolution.Reason;
import static com.liveclass.notification.service.NotificationTargetResolution.State;

/**
 * 알림을 누른 시점의 대상 재판정(CONTRACT §2-4, ADR-0073 §8).
 *
 * <p>다섯 경로 중 <b>이것만 다른 모듈 넷을 읽는다</b> — 커리큘럼·강의·라이브·다시보기. 그래서 알림이
 * 실제로 쌓이기 시작한 뒤로 미뤄 뒀다.
 *
 * <p>판정 순서가 곧 문구의 정확도다. <b>삭제를 먼저 본다</b> — 커리큘럼이 지워지면 수강 관계도 함께
 * 사라지므로, 권한을 먼저 보면 "삭제된 강의입니다"라고 해야 할 자리에 "더 이상 볼 수 없습니다"가 뜬다.
 */
@Service
public class NotificationTargetService {

    private static final Logger log = LoggerFactory.getLogger(NotificationTargetService.class);
    private static final JsonMapper JSON = JsonMapper.builder().build();

    /** 취소된 라이브는 갈 곳이 남아 있어도 갈 이유가 없다. */
    private static final String LIVE_CANCELLED = "CANCELLED";

    private final NotificationRepository repository;
    private final CurriculumDirectory curriculumDirectory;
    private final EnrollmentDirectory enrollmentDirectory;
    private final LessonDirectory lessonDirectory;
    private final LiveSessionDirectory liveSessionDirectory;
    private final ReplayDirectory replayDirectory;

    public NotificationTargetService(NotificationRepository repository,
                                     CurriculumDirectory curriculumDirectory,
                                     EnrollmentDirectory enrollmentDirectory,
                                     LessonDirectory lessonDirectory,
                                     LiveSessionDirectory liveSessionDirectory,
                                     ReplayDirectory replayDirectory) {
        this.repository = repository;
        this.curriculumDirectory = curriculumDirectory;
        this.enrollmentDirectory = enrollmentDirectory;
        this.lessonDirectory = lessonDirectory;
        this.liveSessionDirectory = liveSessionDirectory;
        this.replayDirectory = replayDirectory;
    }

    /**
     * @throws NotificationNotFoundException 내 알림이 아니거나 없을 때. <b>403을 주지 않는다</b> —
     *                                       그러면 그 알림이 존재한다는 사실이 샌다.
     */
    @Transactional
    public NotificationTargetResolution resolve(UUID recipientId, UUID notificationId) {
        Notification notification = repository.findByIdAndRecipientId(notificationId, recipientId)
                .orElseThrow(() -> new NotificationNotFoundException("알림을 찾을 수 없습니다."));

        NotificationTargetResolution resolution = judge(recipientId, notification);
        if (resolution instanceof Gone gone) {
            /*
             * 갈 곳이 없어진 알림은 처리 대기로 남겨 둘 수 없다 — 강사의 "처리 대기" 목록에
             * 영원히 남아 아무리 눌러도 처리되지 않는 항목이 된다. 읽음 축은 건드리지 않는다.
             */
            notification.setActionStatus(NotificationStatus.EXPIRED);
            log.info("알림 대상 소멸 id={} type={} 이유={}",
                    notificationId, notification.getType(), gone.reasonCode());
        }
        return resolution;
    }

    private NotificationTargetResolution judge(UUID viewerId, Notification notification) {
        JsonNode targets = readTargets(notification.getTargets());
        UUID curriculumId = uuid(targets, "curriculumId");
        UUID lessonId = uuid(targets, "lessonId");
        UUID enrollmentId = uuid(targets, "enrollmentId");
        UUID studentId = uuid(targets, "studentId");

        // 1. 커리큘럼이 남아 있는가. 모든 알림이 커리큘럼에 매달려 있다.
        Optional<CurriculumView> curriculum = curriculumDirectory.findById(curriculumId);
        if (curriculum.isEmpty()) {
            return new Gone(Reason.TARGET_DELETED);
        }

        // 2. 강의가 가리켜져 있다면 그것도 남아 있는가.
        Optional<LessonDetailView> lesson = lessonId == null
                ? Optional.empty()
                : lessonDirectory.findDetail(lessonId);
        if (lessonId != null && lesson.isEmpty()) {
            return new Gone(Reason.TARGET_DELETED);
        }

        // 3. 지금도 볼 자격이 있는가. 무엇을 봐야 하는지는 알림 종류가 정한다.
        if (!hasAccess(viewerId, notification.getType(), curriculum.get())) {
            return new Gone(Reason.ACCESS_REVOKED);
        }

        // 4. 때를 놓친 대상인가. 취소된 라이브가 여기 해당한다.
        Optional<LiveSessionView> session = lesson.map(LessonDetailView::lessonId)
                .flatMap(this::liveSessionOf);
        if (session.map(s -> LIVE_CANCELLED.equals(s.liveSessionStatus())).orElse(false)) {
            return new Gone(Reason.TARGET_EXPIRED);
        }

        return new Available(new State(
                curriculumId,
                lesson.map(LessonDetailView::sectionId).orElse(null),
                lessonId,
                session.map(LiveSessionView::sessionId).orElse(null),
                enrollmentId,
                studentId,
                session.map(LiveSessionView::liveSessionStatus).orElse(null),
                session.map(LiveSessionView::scheduledAt).orElse(null),
                lessonId == null ? null : replayStatusOf(lessonId)));
    }

    private boolean hasAccess(UUID viewerId, String type, CurriculumView curriculum) {
        return switch (NotificationAccessRule.of(type)) {
            case INSTRUCTOR_OWNER -> viewerId.equals(curriculum.instructorId());
            case ACTIVE_STUDENT -> enrollmentDirectory.isActive(curriculum.curriculumId(), viewerId);
            /*
             * 카탈로그 규칙은 게시 여부만 본다. 다만 담당 강사는 자기 커리큘럼이 초안이어도 볼 수
             * 있으므로 함께 허용한다 — 강사가 자기 알림에서 막히는 것은 말이 되지 않는다.
             */
            case PUBLISHED_CATALOG -> curriculum.isPublished() || viewerId.equals(curriculum.instructorId());
        };
    }

    /** 레슨에 걸린 라이브 세션. 없으면 빈 값이고, 그건 정상이다(라이브 없는 강의). */
    private Optional<LiveSessionView> liveSessionOf(UUID lessonId) {
        List<LiveSessionView> sessions = liveSessionDirectory.findByLessons(List.of(lessonId));
        return sessions.isEmpty() ? Optional.empty() : Optional.of(sessions.getFirst());
    }

    private String replayStatusOf(UUID lessonId) {
        List<ReplayView> replays = replayDirectory.findByLessons(List.of(lessonId));
        return replays.isEmpty() ? null : replays.getFirst().replayStatus();
    }

    /** 저장된 targets가 깨져 있어도 500을 내지 않는다 — 빈 객체로 보면 대상이 없는 것과 같아진다. */
    private static JsonNode readTargets(String json) {
        if (json == null || json.isBlank()) {
            return JSON.createObjectNode();
        }
        try {
            JsonNode node = JSON.readTree(json);
            return node.isObject() ? node : JSON.createObjectNode();
        } catch (RuntimeException e) {
            return JSON.createObjectNode();
        }
    }

    private static UUID uuid(JsonNode targets, String field) {
        JsonNode value = targets.get(field);
        if (value == null || value.isNull() || !value.isString()) {
            return null;
        }
        try {
            return UUID.fromString(value.asString());
        } catch (IllegalArgumentException e) {
            return null;
        }
    }
}
