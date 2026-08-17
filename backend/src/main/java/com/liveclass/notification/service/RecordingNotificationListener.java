package com.liveclass.notification.service;

import com.liveclass.notification.api.NotificationTypes;
import com.liveclass.notification.config.NotificationMessagingConfig;
import com.liveclass.video.api.RecordingFailedEvent;
import com.liveclass.video.api.RecordingReadyEvent;
import com.liveclass.video.api.ReplayPublishedEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import tools.jackson.databind.json.JsonMapper;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * 녹화·다시보기 사건을 듣고 팬아웃 요청을 아웃박스에 싣는다.
 *
 * <p>세 사건의 <b>받는 사람이 다르다</b> — 녹화 준비·실패는 강사(검수하고 다시 찍을 사람), 다시보기
 * 공개는 수강 중 학생 전원. 규칙은 워커가 종류로 고르므로 여기서는 사건을 그대로 옮기기만 한다.
 *
 * <p>이 경로는 <b>Egress webhook</b>에서도 온다. 외부 호출이 우리 알림 코드 때문에 실패하면 안
 * 되므로, 여기서 하는 일은 다른 리스너와 같이 INSERT 한 줄뿐이다.
 */
@Component
public class RecordingNotificationListener {

    private static final Logger log = LoggerFactory.getLogger(RecordingNotificationListener.class);
    private static final JsonMapper JSON = JsonMapper.builder().build();

    private final WideFanoutPublisher wideFanout;
    private final int sliceLimit;

    public RecordingNotificationListener(WideFanoutPublisher wideFanout,
                                         @Value("${notification.fanout.slice-size:1000}") int sliceLimit) {
        this.wideFanout = wideFanout;
        this.sliceLimit = sliceLimit;
    }

    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
    public void onReady(RecordingReadyEvent event) {
        enqueue(NotificationTypes.RECORDING_READY, event.videoAssetId(), event.lessonId(),
                event.liveSessionId(), event.occurredAt());
    }

    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
    public void onFailed(RecordingFailedEvent event) {
        enqueue(NotificationTypes.RECORDING_FAILED, event.videoAssetId(), event.lessonId(),
                event.liveSessionId(), event.occurredAt());
    }

    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
    public void onReplayPublished(ReplayPublishedEvent event) {
        enqueue(NotificationTypes.VOD_PUBLISHED, event.videoAssetId(), event.lessonId(),
                event.liveSessionId(), event.occurredAt());
    }

    private void enqueue(String type, UUID videoAssetId, UUID lessonId,
                         UUID liveSessionId, OffsetDateTime occurredAt) {
        NotificationFanoutCommand command = NotificationFanoutCommand.forRecording(
                type, videoAssetId, lessonId, liveSessionId, occurredAt, sliceLimit);
        /*
         * 자산 하나당 종류별 한 번이다. 철회했다 다시 공개해도 학생에게 다시 알리지 않는다 —
         * 그 다시보기가 있다는 것은 이미 알고 있고, 오갈 때마다 알리면 소음이 된다.
         */
        wideFanout.publish(command, "video_asset", String.valueOf(videoAssetId),
                "notif:" + type + ':' + videoAssetId);
        log.debug("녹화 알림 팬아웃 요청 적재 type={} asset={}", type, videoAssetId);
    }
}
