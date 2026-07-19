package com.liveclass.video.service;

import com.liveclass.live.api.LiveSessionEndedEvent;
import com.liveclass.live.api.LiveSessionStartedEvent;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * live 세션 생명주기 이벤트 → 녹화 트리거. 커밋 후에만 반응해 롤백된 세션을 녹화하지 않는다.
 * 얇은 글루다 — 실제 로직·트랜잭션은 {@link RecordingService}(별도 빈)가 가져 프록시 자기호출을 피한다.
 * video 모듈에서 live.api에 의존하는 유일한 지점.
 */
@Component
public class RecordingEventListener {

    private final RecordingService recordingService;

    public RecordingEventListener(RecordingService recordingService) {
        this.recordingService = recordingService;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onSessionStarted(LiveSessionStartedEvent event) {
        if (!event.recordingEnabled()) {
            return;   // 녹화 비활성 세션은 자산을 만들지 않는다.
        }
        recordingService.startRecording(event.sessionId(), event.lessonId(), event.roomName());
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onSessionEnded(LiveSessionEndedEvent event) {
        recordingService.stopRecording(event.sessionId());
    }
}
