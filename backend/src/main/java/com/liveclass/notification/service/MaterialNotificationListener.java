package com.liveclass.notification.service;

import com.liveclass.lesson.api.CurriculumMaterialPublishedEvent;
import com.liveclass.notification.config.NotificationMessagingConfig;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import tools.jackson.databind.json.JsonMapper;

/**
 * 자료 게시를 듣고 <b>넓은 팬아웃</b>의 첫 조각을 아웃박스에 싣는다(ADR-0073 §5).
 *
 * <p>수강 사건과 다른 점은 하나다 — <b>여기서 수신자를 세지 않는다</b>. 몇 명인지 알려면 COUNT(*)를
 * 돌려야 하고, 그 값은 워커가 실제로 훑을 때쯤 이미 낡는다. 대신 커서만 비워 보내고 워커가
 * 자기 다음 조각을 이어 간다.
 *
 * <p>{@code BEFORE_COMMIT}인 이유와 여기서 INSERT 한 줄만 하는 이유는
 * {@link EnrollmentNotificationListener}와 같다.
 */
@Component
public class MaterialNotificationListener {

    private static final Logger log = LoggerFactory.getLogger(MaterialNotificationListener.class);
    private static final JsonMapper JSON = JsonMapper.builder().build();

    private final WideFanoutPublisher wideFanout;
    private final int sliceLimit;

    public MaterialNotificationListener(
            WideFanoutPublisher wideFanout,
            @Value("${notification.fanout.slice-size:1000}") int sliceLimit) {
        this.wideFanout = wideFanout;
        this.sliceLimit = sliceLimit;
    }

    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
    public void onMaterialPublished(CurriculumMaterialPublishedEvent event) {
        NotificationFanoutCommand command = NotificationFanoutCommand.forCurriculumMaterial(
                event.curriculumId(), event.curriculumTitle(), event.lessonId(),
                event.materialId(), event.fileName(), event.occurredAt(), sliceLimit);

        wideFanout.publish(command, "material", event.materialId().toString(),
                "notif:MATERIAL_PUBLISHED:" + event.materialId());
        log.debug("자료 알림 팬아웃 요청 적재 material={} curriculum={}",
                event.materialId(), event.curriculumId());
    }
}
