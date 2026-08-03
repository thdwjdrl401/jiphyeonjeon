package com.liveclass.notification.service;

import com.liveclass.auth.api.UserDirectory;
import com.liveclass.auth.api.UserView;
import com.liveclass.notification.api.NewNotification;
import com.liveclass.notification.api.NotificationTypes;
import com.liveclass.notification.config.NotificationMessagingConfig;
import com.liveclass.notification.domain.NotificationStatus;
import com.liveclass.notification.repository.NotificationInsertRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

import java.util.UUID;

/**
 * 팬아웃 워커. 큐에서 사건을 꺼내 <b>실제 알림 행</b>을 만든다(ADR-0073).
 *
 * <p>여기가 터질 수 있는 일을 모아 둔 자리다 — 문구 만들기, 이름 조회, 삽입. 업무 트랜잭션은 이미
 * 오래전에 커밋됐으므로 여기서 무엇이 실패해도 수강 승인은 되돌아가지 않는다.
 *
 * <p><b>같은 메시지가 두 번 와도 안전하다.</b> 릴레이가 발행 직후 죽으면 그 메시지는 다시 발행되고,
 * 실패한 메시지도 재시도된다. 중복은 코드가 아니라 {@code dedupe_key} 유니크 제약이 막는다 —
 * 두 번째 삽입은 0행으로 조용히 끝난다.
 */
@Component
public class NotificationFanoutWorker {

    private static final Logger log = LoggerFactory.getLogger(NotificationFanoutWorker.class);
    private static final JsonMapper JSON = JsonMapper.builder().build();

    private final NotificationInsertRepository insertRepository;
    private final UserDirectory userDirectory;

    public NotificationFanoutWorker(NotificationInsertRepository insertRepository,
                                    UserDirectory userDirectory) {
        this.insertRepository = insertRepository;
        this.userDirectory = userDirectory;
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
        int inserted = insertRepository.insert(build(command));
        log.info("알림 팬아웃 type={} enrollment={} 삽입={}", command.type(), command.enrollmentId(), inserted);
    }

    private NewNotification build(NotificationFanoutCommand command) {
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
                targetsJson(command, toInstructor),
                groupKey(command),
                dedupeKey(command, recipientId));
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
     * 목적지는 화면이 type과 이 id들로 계산한다.
     *
     * <p>{@code studentId}는 강사에게 갈 때만 싣는다. 강사 화면이 로스터에서 그 학생을 짚어 주기
     * 위한 값이라, 학생 본인에게는 의미가 없다.
     */
    private static String targetsJson(NotificationFanoutCommand command, boolean toInstructor) {
        ObjectNode targets = JSON.createObjectNode();
        targets.put("curriculumId", String.valueOf(command.curriculumId()));
        targets.put("enrollmentId", String.valueOf(command.enrollmentId()));
        if (toInstructor && command.studentId() != null) {
            targets.put("studentId", command.studentId().toString());
            targets.put("actorId", command.studentId().toString());
        }
        return JSON.writeValueAsString(targets);
    }

    /** 나중에 "수강 신청 3건"처럼 묶어 보이기 위한 키. 커리큘럼별로 묶는다. */
    private static String groupKey(NotificationFanoutCommand command) {
        return command.type() + ':' + command.curriculumId();
    }

    /**
     * 같은 사건은 한 건만. <b>사건 시각이 들어간다</b> — 거절된 학생이 다시 신청하면 같은 수강 행이
     * 되살아나므로, 시각이 없으면 두 번째 신청이 첫 번째 알림에 묻혀 영영 보이지 않는다.
     */
    private static String dedupeKey(NotificationFanoutCommand command, UUID recipientId) {
        long at = command.occurredAt() == null ? 0L : command.occurredAt().toInstant().toEpochMilli();
        return command.type() + ':' + recipientId + ':' + command.enrollmentId() + ':' + at;
    }
}
