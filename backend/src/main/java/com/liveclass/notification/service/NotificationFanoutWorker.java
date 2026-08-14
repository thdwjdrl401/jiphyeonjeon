package com.liveclass.notification.service;

import com.liveclass.auth.api.UserDirectory;
import com.liveclass.enrollment.api.EnrollmentDirectory;
import com.liveclass.enrollment.api.EnrollmentStatus;
import com.liveclass.lesson.api.LessonDirectory;
import com.liveclass.live.api.LiveSessionDirectory;
import com.liveclass.auth.api.UserView;
import com.liveclass.notification.api.NewNotification;
import com.liveclass.notification.api.NotificationLeadTimes;
import com.liveclass.notification.api.NotificationTypes;
import com.liveclass.notification.config.NotificationMessagingConfig;
import com.liveclass.notification.domain.NotificationStatus;
import com.liveclass.notification.repository.NotificationFanoutRepository;
import com.liveclass.notification.repository.NotificationInsertRepository;
import com.liveclass.notification.repository.NotificationRepository;
import com.liveclass.notification.web.ws.WsNotificationBroadcaster;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * 팬아웃 워커. 큐에서 사건을 꺼내 <b>실제 알림 행</b>을 만든다(ADR-0073).
 *
 * <p>여기가 터질 수 있는 일을 모아 둔 자리다 — 문구 만들기, 이름 조회, 대량 삽입. 업무 트랜잭션은
 * 이미 커밋됐으므로 여기서 무엇이 실패해도 수강 승인이나 자료 연결은 되돌아가지 않는다.
 *
 * <p><b>수신자 규칙은 {@code type}이 고른다.</b> 메시지가 조건을 실어 나르지 않으므로 주입 표면이
 * 없고, 규칙을 고쳐도 큐에 떠 있는 옛 메시지가 새 규칙으로 돈다.
 *
 * <ul>
 *   <li>수강 사건 셋 — 받는 사람이 한 명으로 정해져 있다(좁은 팬아웃).</li>
 *   <li>자료 게시 — 그 커리큘럼의 <b>수강 중</b> 학생 전원. 명단을 앱으로 끌어오지 않고 조각으로 나눈다.</li>
 * </ul>
 *
 * <p><b>같은 메시지가 두 번 와도 안전하다.</b> 릴레이가 발행 직후 죽으면 그 메시지는 다시 발행되고,
 * 실패한 메시지도 재시도된다. 중복은 코드가 아니라 DB가 막는다 — 전역 등록표
 * {@code core.notification_dedupe}에 대한 {@code ON CONFLICT DO NOTHING}이다(ADR-0123).
 */
@Component
public class NotificationFanoutWorker {

    private static final Logger log = LoggerFactory.getLogger(NotificationFanoutWorker.class);
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final int DEFAULT_SLICE = 1000;

    /**
     * 커리큘럼의 수강 중 학생 전원에게 가는 종류들. 나머지는 받는 사람이 한 명으로 정해져 있다.
     *
     * <p>이 집합이 곧 수신자 규칙이다 — 메시지가 조건을 실어 나르지 않으므로, 규칙을 고치면
     * 큐에 떠 있는 옛 메시지도 새 규칙으로 돈다(ADR-0073 §5).
     */
    private static final Set<String> WIDE_TYPES = Set.of(
            NotificationTypes.MATERIAL_PUBLISHED,
            NotificationTypes.LIVE_SCHEDULED,
            NotificationTypes.LIVE_SCHEDULE_CHANGED,
            NotificationTypes.LIVE_CANCELED,
            NotificationTypes.LIVE_STARTING_SOON,
            NotificationTypes.VOD_PUBLISHED);

    /** 담당 강사 한 명에게 가는 종류들. 학생에게 보내면 할 수 있는 일이 없는데 불안만 준다. */
    private static final Set<String> INSTRUCTOR_TYPES = Set.of(
            NotificationTypes.RECORDING_READY,
            NotificationTypes.RECORDING_FAILED);

    private final NotificationInsertRepository insertRepository;
    private final NotificationFanoutRepository fanoutRepository;
    private final NotificationRepository notificationRepository;
    private final UserDirectory userDirectory;
    private final LessonDirectory lessonDirectory;
    private final LiveSessionDirectory liveSessionDirectory;
    private final EnrollmentDirectory enrollmentDirectory;
    private final RabbitTemplate rabbitTemplate;
    private final WsNotificationBroadcaster broadcaster;
    private final NotificationPreferenceService preferenceService;

    public NotificationFanoutWorker(NotificationInsertRepository insertRepository,
                                    NotificationFanoutRepository fanoutRepository,
                                    NotificationRepository notificationRepository,
                                    UserDirectory userDirectory,
                                    LessonDirectory lessonDirectory,
                                    LiveSessionDirectory liveSessionDirectory,
                                    EnrollmentDirectory enrollmentDirectory,
                                    RabbitTemplate rabbitTemplate,
                                    WsNotificationBroadcaster broadcaster,
                                    NotificationPreferenceService preferenceService) {
        this.insertRepository = insertRepository;
        this.fanoutRepository = fanoutRepository;
        this.notificationRepository = notificationRepository;
        this.userDirectory = userDirectory;
        this.lessonDirectory = lessonDirectory;
        this.liveSessionDirectory = liveSessionDirectory;
        this.enrollmentDirectory = enrollmentDirectory;
        this.rabbitTemplate = rabbitTemplate;
        this.broadcaster = broadcaster;
        this.preferenceService = preferenceService;
    }

    @RabbitListener(queues = NotificationMessagingConfig.FANOUT_QUEUE,
            containerFactory = "notificationListenerContainerFactory")
    @Transactional
    public void handle(String payload) {
        NotificationFanoutCommand command = JSON.readValue(payload, NotificationFanoutCommand.class);
        /*
         * 정리 신호는 알림 종류가 아니라 "이미 보낸 알림을 닫아라"다. 종류 검사보다 **먼저** 가려낸다 —
         * SEVERITY에 없어 isKnown이 false이므로, 그대로 두면 알 수 없는 종류로 DLQ에 간다.
         */
        if (NotificationTypes.ENROLLMENT_CANCELED.equals(command.type())) {
            settleEnrollmentRequests(command, NotificationStatus.EXPIRED);
            return;
        }
        if (!NotificationTypes.isKnown(command.type())) {
            // 계약에 없는 종류다. 재시도해도 같으므로 DLQ로 보낸다.
            throw new IllegalArgumentException("알 수 없는 알림 종류입니다: " + command.type());
        }
        if (WIDE_TYPES.contains(command.type())) {
            NotificationFanoutCommand filled = withSessionContext(command);
            if (filled.curriculumId() == null) {
                logMissingContext(filled, "커리큘럼");
                return;
            }
            /*
             * 강사도 곧 시작 알림을 받아야 한다. 팬아웃 SQL은 core.enrollment만 훑는데 <b>강사는
             * 자기 커리큘럼에 수강 등록돼 있지 않아</b> 그 집합에 없다 — 운영에서 수강생 넷은
             * 받고 강사만 못 받는 일이 실제로 있었다.
             *
             * 나머지 라이브 알림(예정·변경·취소)은 강사가 <b>방금 자기가 한 일</b>이라 보내지 않는다.
             */
            if (NotificationTypes.LIVE_STARTING_SOON.equals(filled.type())) {
                notifyInstructorOfStartingSoon(filled);
            }
            fanOutToCurriculumStudents(filled);
            return;
        }
        if (INSTRUCTOR_TYPES.contains(command.type())) {
            NotificationFanoutCommand filled = withSessionContext(command);
            if (filled.instructorId() == null) {
                logMissingContext(filled, "강사");
                return;
            }
            NewNotification forInstructor = buildForInstructor(filled);
            int sent = insertRepository.insert(forInstructor);
            if (sent > 0) {
                broadcaster.announce(filled.instructorId(), filled.type(),
                        forInstructor.title(), forInstructor.message());
            }
            log.info("녹화 알림 type={} asset={} 삽입={}", filled.type(), filled.videoAssetId(), sent);
            return;
        }
        NewNotification notification = buildForEnrollment(command);
        int inserted = insertRepository.insert(notification);
        // 새로 넣었을 때만 알린다. 재배달로 중복이면 화면에 두 번 뜰 이유가 없다.
        if (inserted > 0) {
            broadcaster.announce(notification.recipientId(), command.type(),
                    notification.title(), notification.message());
        }
        log.info("알림 팬아웃 type={} enrollment={} 삽입={}", command.type(), command.enrollmentId(), inserted);

        /*
         * 강사가 처리했으니 그 신청의 대기 알림을 닫는다. 학생에게 결과를 보내는 것과 **같은
         * 사건**이므로 같은 트랜잭션에서 함께 처리한다 — 갈라지면 결과는 갔는데 강사의 처리 대기는
         * 남는, 지금 운영에서 벌어지고 있는 상태가 된다.
         */
        if (NotificationTypes.ENROLLMENT_APPROVED.equals(command.type())
                || NotificationTypes.ENROLLMENT_REJECTED.equals(command.type())) {
            settleEnrollmentRequests(command, NotificationStatus.COMPLETED);
        }
    }

    /**
     * 그 수강 신청에 걸려 있던 강사의 대기 알림을 닫는다.
     *
     * <p><b>지금 수강 상태를 먼저 본다.</b> 메시지는 재배달될 수 있는데, 늦게 도착한 결정 메시지가
     * 그 사이 학생이 <b>다시 신청해</b> 새로 생긴 대기 알림까지 닫아 버리면 강사는 처리해야 할 일을
     * 보지 못한다. 거절된 학생의 재신청은 같은 수강 행을 되살리므로(EnrollmentService.apply)
     * enrollmentId만으로는 두 신청을 구분할 수 없다.
     *
     * <p>수강 행이 아예 없으면(커리큘럼 삭제로 함께 지워졌다) 기다릴 일도 없으므로 그대로 닫는다.
     */
    private void settleEnrollmentRequests(NotificationFanoutCommand command, String status) {
        if (command.enrollmentId() == null) {
            return;
        }
        boolean pendingAgain = enrollmentDirectory.findById(command.enrollmentId())
                .map(view -> view.status() == EnrollmentStatus.PENDING)
                .orElse(false);
        if (pendingAgain) {
            log.info("수강 신청이 다시 대기 중이라 알림을 닫지 않음 enrollment={}", command.enrollmentId());
            return;
        }
        OffsetDateTime settledAt = command.occurredAt() == null ? OffsetDateTime.now() : command.occurredAt();
        int settled = notificationRepository.settleEnrollmentRequests(
                command.enrollmentId().toString(), status, settledAt);
        log.info("수강 신청 알림 처리 축 정리 enrollment={} 상태={} 갱신={}",
                command.enrollmentId(), status, settled);
    }

    /**
     * 보낼 곳을 못 찾았다. <b>예외를 던지지 않는다</b> — 재시도해도 같고(세션은 다시 생기지 않는다),
     * 알릴 대상이 없는 것은 DLQ에 쌓아 둘 만큼 심각한 일이 아니다. 다만 조용히 사라지면 나중에
     * "알림이 안 왔다"를 추적할 수 없으므로 로그는 남긴다.
     */
    private void logMissingContext(NotificationFanoutCommand command, String missing) {
        log.warn("알림 대상을 찾지 못해 건너뜀 type={} session={} 없는값={}",
                command.type(), command.liveSessionId(), missing);
    }

    /**
     * 라이브 세션에서 커리큘럼·강사를 채운다. 녹화 사건은 둘 다 모르고 세션이 안다.
     *
     * <p>세션이 사라졌으면 채우지 못한 채로 돌아온다. 그 판단(보낼 곳이 없다)은 부르는 쪽이 한다.
     */
    private NotificationFanoutCommand withSessionContext(NotificationFanoutCommand command) {
        if (command.liveSessionId() == null
                || (command.curriculumId() != null && command.instructorId() != null)) {
            return command;
        }
        return liveSessionDirectory.findById(command.liveSessionId())
                .map(session -> command.withSession(
                        liveSessionDirectory.findCurriculumId(command.liveSessionId()).orElse(null),
                        session.instructorId()))
                .orElse(command);
    }

    /** 강사 한 명에게 가는 녹화 알림. */
    private NewNotification buildForInstructor(NotificationFanoutCommand command) {
        String subject = lessonTitleOf(command.lessonId());
        ObjectNode targets = JSON.createObjectNode();
        targets.put("curriculumId", String.valueOf(command.curriculumId()));
        targets.put("lessonId", String.valueOf(command.lessonId()));
        targets.put("liveSessionId", String.valueOf(command.liveSessionId()));
        targets.put("recordingId", String.valueOf(command.videoAssetId()));

        return NewNotification.of(
                command.instructorId(),
                command.type(),
                // 녹화 실패는 강사가 **다시 찍어야** 하는 일이지만, 처리 축은 우리가 완료를 판정할
                // 수 있을 때만 쓴다. 재촬영 완료를 서버가 알 방법이 없으므로 INFO로 둔다.
                NotificationStatus.INFO,
                NotificationTypes.severityOf(command.type()),
                NotificationCopy.title(command.type()),
                NotificationCopy.recordingMessage(command.type(), subject),
                JSON.writeValueAsString(targets),
                command.type() + ':' + command.liveSessionId(),
                command.type() + ':' + command.instructorId() + ':' + command.videoAssetId());
    }

    /**
     * 곧 시작 알림을 담당 강사에게. <b>첫 조각에서만</b> 넣는다 — 뒤 조각에서도 부르면 중복 키가
     * 막아 주긴 하지만 조각 수만큼 헛일이 된다.
     *
     * <p>리드타임 판정은 수강생과 <b>같은 규칙</b>이다(강의 → 커리큘럼 → 기본값). 강사만 다른
     * 규칙을 쓰면 설정 화면이 보여 주는 값과 실제로 오는 시각이 어긋난다.
     */
    private void notifyInstructorOfStartingSoon(NotificationFanoutCommand command) {
        if (command.afterUserId() != null || command.instructorId() == null) {
            return;
        }
        int lead = command.leadMinutes() == null ? NotificationLeadTimes.DEFAULT_MINUTES : command.leadMinutes();
        var effective = preferenceService.effective(
                command.instructorId(), command.curriculumId(), command.lessonId());
        if (!effective.enabled() || effective.leadMinutes() != lead) {
            return;
        }
        String subject = lessonTitleOf(command.lessonId());
        int inserted = insertRepository.insert(NewNotification.of(
                command.instructorId(),
                command.type(),
                NotificationStatus.INFO,
                NotificationTypes.severityOf(command.type()),
                NotificationCopy.title(command.type()),
                NotificationCopy.wideMessage(command.type(), command.curriculumTitle(), subject,
                        null, command.nextStartsAt()),
                wideTargetsJson(command),
                command.type() + ':' + command.curriculumId(),
                dedupePrefix(command) + command.instructorId()));
        if (inserted > 0) {
            broadcaster.announce(command.instructorId(), command.type(),
                    NotificationCopy.title(command.type()),
                    NotificationCopy.wideMessage(command.type(), command.curriculumTitle(), subject,
                            null, command.nextStartsAt()));
        }
    }

    // ---- 넓은 팬아웃 ----

    /**
     * 한 조각을 넣고, 가득 찼으면 <b>자기 다음 조각을 큐에 넣는다</b>.
     *
     * <p>몇 조각인지 미리 세지 않는다 — 100만 행에 COUNT(*)를 돌릴 일이 없고, 큐 길이가 워커 속도에
     * 맞춰 저절로 조절된다.
     *
     * <p>다음 조각을 아웃박스가 아니라 <b>브로커로 바로</b> 보내는 이유는, 이 시점에 지켜야 할
     * 업무 트랜잭션이 없기 때문이다. 아웃박스는 업무 변경과 메시지를 함께 커밋하기 위한 장치인데
     * 여기엔 함께 커밋할 업무 변경이 없다.
     *
     * <p>도중에 죽으면 이 메시지는 ack되지 않아 통째로 재배달된다. 그 조각을 다시 넣어도 중복 제거가
     * 막고, 다음 조각도 다시 발행된다 — 체인이 끊기지 않는다.
     */
    private void fanOutToCurriculumStudents(NotificationFanoutCommand command) {
        int limit = command.sliceLimit() == null ? DEFAULT_SLICE : command.sliceLimit();
        /*
         * 대상 이름은 종류마다 출처가 다르다 — 자료 알림은 메시지가 파일명을 싣고 오고, 라이브
         * 알림은 여기서 레슨 제목을 찾는다. 라이브 세션은 제목을 갖지 않고 레슨이 갖는데, 그것을
         * 발행 시점에 조회하면 업무 트랜잭션이 그만큼 길어진다(ADR-0073 §3).
         */
        String subject = command.subjectName() != null ? command.subjectName() : lessonTitleOf(command.lessonId());
        String title = NotificationCopy.title(command.type());
        String message = NotificationCopy.wideMessage(command.type(), command.curriculumTitle(), subject,
                command.previousStartsAt(), command.nextStartsAt());

        NotificationFanoutRepository.Slice slice = NotificationTypes.LIVE_STARTING_SOON.equals(command.type())
                ? fanoutRepository.insertForStartingSoon(
                        command.curriculumId(), command.lessonId(), command.afterUserId(), limit,
                        command.leadMinutes() == null
                                ? NotificationLeadTimes.DEFAULT_MINUTES : command.leadMinutes(),
                        NotificationLeadTimes.DEFAULT_MINUTES,
                        command.type(), NotificationStatus.INFO, NotificationTypes.severityOf(command.type()),
                        title, message, wideTargetsJson(command),
                        command.type() + ':' + command.curriculumId(),
                        dedupePrefix(command), command.nextStartsAt())
                : fanoutRepository.insertForActiveStudents(
                command.curriculumId(), command.afterUserId(), limit,
                command.type(), NotificationStatus.INFO, NotificationTypes.severityOf(command.type()),
                title, message, wideTargetsJson(command),
                command.type() + ':' + command.curriculumId(),
                dedupePrefix(command),
                command.previousStartsAt(), command.nextStartsAt());

        // 문구는 조각 전체가 같다 — 넓은 팬아웃은 사람 이름을 넣지 않는다.
        broadcaster.announceAll(slice.insertedRecipients(), command.type(), title, message);

        log.info("넓은 팬아웃 조각 type={} curriculum={} 커서={} 훑음={} 삽입={}",
                command.type(), command.curriculumId(), command.afterUserId(),
                slice.scanned(), slice.inserted());

        if (slice.mayHaveMore(limit)) {
            rabbitTemplate.convertAndSend(NotificationMessagingConfig.FANOUT_QUEUE,
                    JSON.writeValueAsString(command.nextSlice(slice.lastUserId())));
        }
    }

    /**
     * 중복 제거 키의 앞부분(뒤에 수신자 id가 붙는다).
     *
     * <p><b>일정 변경만 시각이 들어간다.</b> 같은 세션의 두 번째 변경이 첫 번째에 묻히면 학생은
     * 옛 시각을 그대로 믿는다. 나머지는 사건마다 새 id가 생기므로 시각이 필요 없다 — 자료는 새
     * materialId, 예정·취소는 세션당 한 번이다.
     */
    private static String dedupePrefix(NotificationFanoutCommand command) {
        String subject = command.materialId() != null
                ? command.materialId().toString()
                : command.videoAssetId() != null
                        ? command.videoAssetId().toString()
                        : String.valueOf(command.liveSessionId());
        if (NotificationTypes.LIVE_SCHEDULE_CHANGED.equals(command.type())) {
            long at = command.nextStartsAt() == null ? 0L : command.nextStartsAt().toInstant().toEpochMilli();
            return command.type() + ':' + subject + ':' + at + ':';
        }
        /*
         * 곧 시작 알림은 회차(시작 시각)마다 새 알림이다. 리드타임은 키에 넣지 않는다 — 한 사람은
         * 어차피 자기 리드타임 하나에만 걸리고, 넣으면 일정이 바뀌었을 때 옛 리드타임 행과 새 행이
         * 서로 다른 키가 되어 같은 회차 알림이 두 번 뜬다.
         */
        if (NotificationTypes.LIVE_STARTING_SOON.equals(command.type())) {
            long at = command.nextStartsAt() == null ? 0L : command.nextStartsAt().toInstant().toEpochMilli();
            return command.type() + ':' + subject + ':' + at + ':';
        }
        return command.type() + ':' + subject + ':';
    }

    private String lessonTitleOf(UUID lessonId) {
        if (lessonId == null) {
            return null;
        }
        return lessonDirectory.findTitles(List.of(lessonId)).get(lessonId);
    }

    /** 넓은 팬아웃의 대상 리소스들. 종류에 따라 자료·라이브 중 있는 것만 담는다. */
    private static String wideTargetsJson(NotificationFanoutCommand command) {
        ObjectNode targets = JSON.createObjectNode();
        targets.put("curriculumId", String.valueOf(command.curriculumId()));
        if (command.materialId() != null) {
            targets.put("materialId", command.materialId().toString());
        }
        if (command.liveSessionId() != null) {
            targets.put("liveSessionId", command.liveSessionId().toString());
        }
        if (command.videoAssetId() != null) {
            targets.put("recordingId", command.videoAssetId().toString());
        }
        // 레슨 자료·라이브면 레슨으로, 커리큘럼 전체 자료면 커리큘럼으로 보낸다.
        if (command.lessonId() != null) {
            targets.put("lessonId", command.lessonId().toString());
        }
        return JSON.writeValueAsString(targets);
    }

    // ---- 좁은 팬아웃 ----

    private NewNotification buildForEnrollment(NotificationFanoutCommand command) {
        boolean toInstructor = NotificationTypes.ENROLLMENT_REQUESTED.equals(command.type());
        UUID recipientId = toInstructor ? command.instructorId() : command.studentId();

        /*
         * 처리 축은 "받는 사람이 할 일이 남았는가"다. 강사에게 가는 신청 알림만 ACTION_REQUIRED이고,
         * 학생에게 가는 결과 통보는 읽고 끝이라 INFO다. 읽음 축과 합치지 않는다 — 강사가 읽어도
         * 승인 전까지 할 일은 남아야 한다(ADR-0073 §7).
         */
        String actionStatus = toInstructor ? NotificationStatus.ACTION_REQUIRED : NotificationStatus.INFO;

        return NewNotification.of(
                recipientId,
                command.type(),
                actionStatus,
                NotificationTypes.severityOf(command.type()),
                NotificationCopy.title(command.type()),
                NotificationCopy.message(command.type(), command.curriculumTitle(),
                        toInstructor ? displayNameOf(command.studentId()) : null),
                enrollmentTargetsJson(command, toInstructor),
                command.type() + ':' + command.curriculumId(),
                enrollmentDedupeKey(command, recipientId));
    }

    /** 이름 조회가 실패해도 알림은 나간다 — 이름 없는 문장이 알림이 아예 없는 것보다 낫다. */
    private String displayNameOf(UUID userId) {
        if (userId == null) {
            return null;
        }
        return userDirectory.findById(userId).map(UserView::displayName).orElse(null);
    }

    /**
     * 가리키는 리소스들. <b>프론트 경로를 담지 않는다</b> — 경로가 바뀌면 쌓인 알림이 전부 깨진다.
     *
     * <p>{@code studentId}는 강사에게 갈 때만 싣는다. 강사 화면이 로스터에서 그 학생을 짚어 주기
     * 위한 값이라, 학생 본인에게는 의미가 없다.
     */
    private static String enrollmentTargetsJson(NotificationFanoutCommand command, boolean toInstructor) {
        ObjectNode targets = JSON.createObjectNode();
        targets.put("curriculumId", String.valueOf(command.curriculumId()));
        targets.put("enrollmentId", String.valueOf(command.enrollmentId()));
        if (toInstructor && command.studentId() != null) {
            targets.put("studentId", command.studentId().toString());
            targets.put("actorId", command.studentId().toString());
        }
        return JSON.writeValueAsString(targets);
    }

    /**
     * 같은 사건은 한 건만. <b>사건 시각이 들어간다</b> — 거절된 학생이 다시 신청하면 같은 수강 행이
     * 되살아나므로, 시각이 없으면 두 번째 신청이 첫 번째 알림에 묻혀 영영 보이지 않는다.
     */
    private static String enrollmentDedupeKey(NotificationFanoutCommand command, UUID recipientId) {
        long at = command.occurredAt() == null ? 0L : command.occurredAt().toInstant().toEpochMilli();
        return command.type() + ':' + recipientId + ':' + command.enrollmentId() + ':' + at;
    }
}
