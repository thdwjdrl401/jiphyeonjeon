package com.liveclass.notification.service;

import com.liveclass.auth.api.UserDirectory;
import com.liveclass.auth.api.UserView;
import com.liveclass.notification.api.NewNotification;
import com.liveclass.notification.api.NotificationTypes;
import com.liveclass.notification.config.NotificationMessagingConfig;
import com.liveclass.notification.domain.NotificationStatus;
import com.liveclass.notification.repository.NotificationFanoutRepository;
import com.liveclass.notification.repository.NotificationInsertRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

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
 * 실패한 메시지도 재시도된다. 중복은 코드가 아니라 {@code dedupe_key} 유니크 제약이 막는다.
 */
@Component
public class NotificationFanoutWorker {

    private static final Logger log = LoggerFactory.getLogger(NotificationFanoutWorker.class);
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final int DEFAULT_SLICE = 1000;

    private final NotificationInsertRepository insertRepository;
    private final NotificationFanoutRepository fanoutRepository;
    private final UserDirectory userDirectory;
    private final RabbitTemplate rabbitTemplate;

    public NotificationFanoutWorker(NotificationInsertRepository insertRepository,
                                    NotificationFanoutRepository fanoutRepository,
                                    UserDirectory userDirectory,
                                    RabbitTemplate rabbitTemplate) {
        this.insertRepository = insertRepository;
        this.fanoutRepository = fanoutRepository;
        this.userDirectory = userDirectory;
        this.rabbitTemplate = rabbitTemplate;
    }

    @RabbitListener(queues = NotificationMessagingConfig.FANOUT_QUEUE,
            containerFactory = "notificationListenerContainerFactory")
    @Transactional
    public void handle(String payload) {
        NotificationFanoutCommand command = JSON.readValue(payload, NotificationFanoutCommand.class);
        if (!NotificationTypes.isKnown(command.type())) {
            // 계약에 없는 종류다. 재시도해도 같으므로 DLQ로 보낸다.
            throw new IllegalArgumentException("알 수 없는 알림 종류입니다: " + command.type());
        }
        if (NotificationTypes.MATERIAL_PUBLISHED.equals(command.type())) {
            fanOutToCurriculumStudents(command);
            return;
        }
        int inserted = insertRepository.insert(buildForEnrollment(command));
        log.info("알림 팬아웃 type={} enrollment={} 삽입={}", command.type(), command.enrollmentId(), inserted);
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
        String title = NotificationCopy.title(command.type());
        String message = NotificationCopy.message(command.type(), command.curriculumTitle(), command.subjectName());

        NotificationFanoutRepository.Slice slice = fanoutRepository.insertForActiveStudents(
                command.curriculumId(), command.afterUserId(), limit,
                command.type(), NotificationStatus.INFO, NotificationTypes.severityOf(command.type()),
                title, message, materialTargetsJson(command),
                command.type() + ':' + command.curriculumId(),
                command.type() + ':' + command.materialId() + ':');

        log.info("자료 알림 조각 curriculum={} 커서={} 훑음={} 삽입={}",
                command.curriculumId(), command.afterUserId(), slice.scanned(), slice.inserted());

        if (slice.mayHaveMore(limit)) {
            rabbitTemplate.convertAndSend(NotificationMessagingConfig.FANOUT_QUEUE,
                    JSON.writeValueAsString(command.nextSlice(slice.lastUserId())));
        }
    }

    /**
     * 자료 알림의 중복 제거 키는 {@code {type}:{materialId}:{userId}}다. 자료 연결은 되살아나는 사건이
     * 아니라 새 자료마다 새 id가 생기므로, 수강 알림과 달리 시각을 넣을 필요가 없다.
     */
    private static String materialTargetsJson(NotificationFanoutCommand command) {
        ObjectNode targets = JSON.createObjectNode();
        targets.put("curriculumId", String.valueOf(command.curriculumId()));
        targets.put("materialId", String.valueOf(command.materialId()));
        // 레슨 자료면 레슨으로, 커리큘럼 전체 자료면 커리큘럼으로 보낸다.
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
